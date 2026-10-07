import { assertCredits, recordUsage, onApiError } from '../aiCredits';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { getActor } from '@/lib/auth';
import { readFile } from '@/lib/storage';
import { sqlNow } from '@/lib/time';
import { API_TOOLS, getTool, validate, riskOf, serializeResult } from './tools';
import { SYSTEM_PROMPT } from './prompt';

const MODEL = process.env.ASSISTANT_MODEL || 'claude-opus-5-5';
const MAX_STEPS = 30;
// Stored in place of an image's base64 so history stays small; expanded to the identical bytes on
// every request, which keeps the history append-only from the API's point of view.
const IMAGE_MARKER = '__image_library__:';

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env');
  return new Anthropic({ apiKey });
}

async function loadConversation(id): Promise<any> {
  const row = await prisma.assistant_conversations.findUnique({ where: { id } });
  if (!row) return null;
  return { ...row, messages: JSON.parse(row.messages || '[]'), pending: row.pending ? JSON.parse(row.pending) : null };
}

async function saveConversation(conv) {
  await prisma.assistant_conversations.update({
    where: { id: conv.id },
    data: {
      title: conv.title,
      messages: JSON.stringify(conv.messages),
      pending: conv.pending ? JSON.stringify(conv.pending) : null,
      status: conv.status,
      updated_at: sqlNow(),
    },
  });
}

async function createConversation(title, createdBy = null) {
  const r = await prisma.assistant_conversations.create({ data: { title, status: 'idle', created_by: createdBy } });
  return loadConversation(r.id);
}

function imageBlockFor(imageId) {
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: `${IMAGE_MARKER}${imageId}` } };
}

// PORT NOTE: now async; model_path is a storage key read via lib/storage readFile (null = missing).
async function expandImages(messages) {
  return Promise.all(
    messages.map(async (m) => {
      if (!Array.isArray(m.content)) return m;
      let changed = false;
      const content = await Promise.all(
        m.content.map(async (b) => {
          if (b.type === 'image' && typeof b.source?.data === 'string' && b.source.data.startsWith(IMAGE_MARKER)) {
            const imageId = Number(b.source.data.slice(IMAGE_MARKER.length));
            const img = await prisma.image_library.findUnique({ where: { id: imageId }, select: { model_path: true } });
            const bytes = img && img.model_path ? await readFile(img.model_path) : null;
            if (!bytes) {
              changed = true;
              return { type: 'text', text: `[Attached image ${imageId} is no longer available]` };
            }
            changed = true;
            return { ...b, source: { ...b.source, data: bytes.toString('base64') } };
          }
          return b;
        })
      );
      return changed ? { ...m, content } : m;
    })
  );
}

// If a run was stopped after the model asked for tools but before their results were stored, the
// history would end with unanswered tool_use blocks, which the API rejects. Answer them.
function closeDanglingToolUses(conv, reason) {
  const last = conv.messages[conv.messages.length - 1];
  if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return;
  const toolUses = last.content.filter((b) => b.type === 'tool_use');
  if (!toolUses.length) return;
  conv.messages.push({
    role: 'user',
    content: toolUses.map((tu) => ({ type: 'tool_result', tool_use_id: tu.id, content: reason, is_error: true })),
  });
}

async function recordChange(conv, toolName, change) {
  const r = await prisma.site_changes.create({
    data: {
      conversation_id: conv.id,
      tool: toolName,
      summary: change.summary,
      target_type: change.targetType || null,
      target_id: change.targetId || null,
      undo: change.undo ? JSON.stringify(change.undo) : null,
    },
  });
  await activity.log('assistant.site_change', {
    entityType: change.targetType || 'site',
    entityId: Number(change.targetId) || null,
    details: change.summary,
    actor: `Assistant (approved by ${await getActor()})`,
    source: 'assistant',
  });
  return Number(r.id);
}

async function runTool(conv, name, input, emit, toolUseId) {
  const tool = getTool(name);
  emit({ type: 'tool_start', toolUseId, name, summary: tool.summarize(input) });
  try {
    const out = await tool.run(input, { conversationId: conv.id, emit });
    let result = tool.kind === 'write' ? out.result : out;
    let changeId: number | null = null;
    if (tool.kind === 'write' && out.change) {
      changeId = await recordChange(conv, name, out.change);
      result = { ...result, change_id: changeId, note: 'Change recorded. The user can undo it from the dashboard.' };
    }
    emit({ type: 'tool_result', toolUseId, name, ok: true, changeId });
    return { type: 'tool_result', tool_use_id: toolUseId, content: serializeResult(result) };
  } catch (err: any) {
    emit({ type: 'tool_result', toolUseId, name, ok: false, error: err.message });
    return { type: 'tool_result', tool_use_id: toolUseId, content: `Error: ${err.message}`, is_error: true };
  }
}

async function runLoop(conv, emit, signal) {
  const client = getClient();
  conv.status = 'running';
  await saveConversation(conv);

  try {
    let jsonRetries = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      await assertCredits();
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 32000,
          betas: ['server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18'],
          fallbacks: 'default',
          // The model's short notes between tool calls come back as thinking blocks on this model;
          // "updates" returns them as readable text (reasoning itself stays hidden).
          thinking: { type: 'adaptive', display: 'updates' },
          output_config: { effort: 'high' },
          cache_control: { type: 'ephemeral' },
          system: SYSTEM_PROMPT,
          tools: API_TOOLS,
          messages: await expandImages(conv.messages),
        },
        { signal }
      );
      stream.on('text', (text) => emit({ type: 'text_delta', text }));
      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start' && event.content_block.type === 'thinking') emit({ type: 'progress_start' });
        if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta' && event.delta.thinking) {
          emit({ type: 'progress_delta', text: event.delta.thinking });
        }
      });

      let message;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
        await recordUsage({ model: message.model || MODEL, usage: message.usage, feature: 'assistant' });
      } catch (err: any) {
        await onApiError(err);
        if (signal.aborted || err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        emit({ type: 'notice', text: 'Retrying a step that came back malformed…' });
        continue;
      }

      conv.messages.push({ role: 'assistant', content: message.content });
      await saveConversation(conv);
      emit({ type: 'assistant_turn_end' });

      if (message.stop_reason === 'pause_turn') continue;
      if (message.stop_reason === 'refusal') {
        emit({ type: 'notice', text: 'The AI declined this request.' });
        break;
      }

      const toolUses = message.content.filter((b) => b.type === 'tool_use');
      if (!toolUses.length) break;

      if (message.stop_reason === 'max_tokens') {
        conv.messages.push({
          role: 'user',
          content: toolUses.map((tu) => ({
            type: 'tool_result',
            tool_use_id: tu.id,
            is_error: true,
            content: 'Your tool input was cut off because the response was too long. Make the change in smaller pieces.',
          })),
        });
        await saveConversation(conv);
        continue;
      }

      const readResults: any[] = [];
      const actions: any[] = [];
      for (const tu of toolUses) {
        const tool = getTool(tu.name);
        if (!tool) {
          readResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Unknown tool "${tu.name}"`, is_error: true });
          continue;
        }
        const invalid = validate(tool.input_schema, tu.input);
        if (invalid) {
          readResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Invalid input: ${invalid}`, is_error: true });
          continue;
        }
        if (tool.kind === 'read') {
          readResults.push(await runTool(conv, tu.name, tu.input, emit, tu.id));
          continue;
        }
        let preview: any = null;
        if (tool.preview) {
          try {
            preview = await tool.preview(tu.input);
          } catch (err: any) {
            preview = { problem: `Could not build a preview: ${err.message}` };
          }
        }
        actions.push({ toolUseId: tu.id, name: tu.name, input: tu.input, summary: tool.summarize(tu.input), risk: riskOf(tool, tu.input), preview });
      }

      if (actions.length) {
        conv.pending = { readResults, actions };
        conv.status = 'awaiting_approval';
        await saveConversation(conv);
        emit({ type: 'approval_required', actions });
        return;
      }

      conv.messages.push({ role: 'user', content: readResults });
      await saveConversation(conv);
    }
    conv.status = 'idle';
    await saveConversation(conv);
  } catch (err: any) {
    closeDanglingToolUses(conv, signal.aborted ? 'Stopped by the user before this ran.' : `Not run: ${err.message}`);
    conv.status = 'idle';
    await saveConversation(conv);
    throw err;
  }
}

// A new user message. If actions were waiting for approval, they are declined first (the user
// moved on), all inside one user turn so the history stays valid.
async function sendMessage({ conversationId, text, imageIds = [], actor = null }: any, emit, signal) {
  let conv = conversationId ? await loadConversation(conversationId) : null;
  if (conversationId && !conv) throw new Error('Conversation not found');
  if (conv && conv.status === 'running') throw new Error('The assistant is still working on the previous message. Stop it first.');
  if (conv) {
    // Claim the conversation atomically so two quick sends cannot both run.
    const claim = await prisma.assistant_conversations.updateMany({ where: { id: conv.id, status: { not: 'running' } }, data: { status: 'running' } });
    if (claim.count !== 1) throw new Error('The assistant is still working on the previous message. Stop it first.');
    conv.status = 'running';
  }
  if (!conv) conv = await createConversation((text || 'New conversation').replace(/<attached_document[\s\S]*$/, '').trim().slice(0, 70) || 'New conversation', actor);
  emit({ type: 'conversation', id: conv.id, title: conv.title });

  const content: any[] = [];
  if (conv.pending) {
    content.push(...conv.pending.readResults);
    for (const a of conv.pending.actions) {
      content.push({ type: 'tool_result', tool_use_id: a.toolUseId, content: 'Not approved: the user sent a new message instead. Do not retry unless they ask.' });
    }
    conv.pending = null;
  }
  const images = imageIds.length
    ? await prisma.image_library.findMany({ where: { id: { in: imageIds } }, select: { id: true, filename: true, width: true, height: true }, orderBy: { id: 'asc' } })
    : [];
  for (const img of images) content.push(imageBlockFor(img.id));
  const imageNotes = images
    .map((img) => `[Attached image_id ${img.id}: ${img.filename}${img.width ? `, ${img.width}x${img.height}px` : ''}. To put it on the website, upload it with wp_upload_image using image_id ${img.id}.]`)
    .join('\n');
  content.push({ type: 'text', text: [text || '', imageNotes].filter(Boolean).join('\n\n') || '(image attached)' });
  conv.messages.push({ role: 'user', content });
  await saveConversation(conv);

  await runLoop(conv, emit, signal);
  return conv.id;
}

// The user approved and/or rejected the pending actions.
async function decide({ conversationId, decisions }, emit, signal) {
  const conv = await loadConversation(conversationId);
  if (!conv) throw new Error('Conversation not found');
  if (conv.status !== 'awaiting_approval' || !conv.pending) throw new Error('Nothing is waiting for approval in this conversation.');

  // Claim the pending batch atomically so a double-click on Approve cannot run the writes twice.
  const claim = await prisma.assistant_conversations.updateMany({ where: { id: conv.id, status: 'awaiting_approval' }, data: { status: 'running' } });
  if (claim.count !== 1) throw new Error('Nothing is waiting for approval in this conversation.');

  const { readResults, actions } = conv.pending;
  conv.pending = null;
  conv.status = 'running';
  await saveConversation(conv);

  const results: any[] = [...readResults];
  for (const action of actions) {
    const d = (decisions || []).find((x) => x.toolUseId === action.toolUseId);
    if (!d || !d.approve) {
      emit({ type: 'tool_result', toolUseId: action.toolUseId, name: action.name, ok: false, declined: true });
      results.push({
        type: 'tool_result',
        tool_use_id: action.toolUseId,
        content: `The user declined this action${d && d.note ? `, saying: "${d.note}"` : ''}. Do not retry it unless they ask.`,
      });
      continue;
    }
    results.push(await runTool(conv, action.name, action.input, emit, action.toolUseId));
  }
  conv.messages.push({ role: 'user', content: results });
  await saveConversation(conv);

  await runLoop(conv, emit, signal);
}

export { sendMessage, decide, loadConversation, IMAGE_MARKER, MODEL };
