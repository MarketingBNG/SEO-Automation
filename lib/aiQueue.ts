// Testing mode: AI work runs on the owner's Claude Code subscription instead of the Anthropic API.
//
// Live mode (the default): every Claude request goes to the API, as before.
// Testing mode (an admin switches it in Settings > AI credits):
//  - work a person starts (write a blog, check a blog, fact check, strategy...) does not call the
//    API. Each request is saved in ai_jobs and the run waits; Claude Code answers the queue on the
//    owner's subscription (scripts/agent.ts: "run the SEO AI queue"), and the run carries on.
//  - automatic work (the 15-minute scheduler and the cron routes) does not start at all: it stops
//    as if AI credits were paused and continues by itself when Live mode is back.
// No API credits are used in Testing mode.
import { AsyncLocalStorage } from 'node:async_hooks';
import prisma from './prisma';
import * as settings from './settings';
import { CreditPausedError } from './aiCredits';
import { sqlNow } from './time';

export type AiMode = 'live' | 'testing';

let cached: { at: number; mode: AiMode } | null = null;

// Tests pin the mode for their own process (tests/setup.ts sets it), so a test database left in
// Testing mode does not send a test's requests to the Claude Code queue, where they would wait
// forever, and a test that switches modes does not switch them for test files running alongside.
const pinned = (): AiMode | null => {
  const m = (globalThis as any).__AI_MODE_PIN;
  return m === 'live' || m === 'testing' ? m : null;
};

export async function aiMode(): Promise<AiMode> {
  const pin = pinned();
  if (pin) return pin;
  if (cached && Date.now() - cached.at < 10000) return cached.mode;
  const mode: AiMode = (await settings.get('ai_mode').catch(() => null)) === 'testing' ? 'testing' : 'live';
  cached = { at: Date.now(), mode };
  return mode;
}

export async function setAiMode(mode: AiMode) {
  await settings.set('ai_mode', mode);
  cached = { at: Date.now(), mode };
}

// Work started by the scheduler or a cron route, not by a person.
const automatic = new AsyncLocalStorage<boolean>();
export const runAutomatic = <T>(fn: () => Promise<T>): Promise<T> => automatic.run(true, fn);
export const isAutomatic = () => automatic.getStore() === true;

// Paused AI credits and Testing mode stop automatic work the same way: it waits, and continues by
// itself once AI work is possible again ("AI work is paused" is what the resume logic looks for).
export class TestingModeError extends CreditPausedError {
  constructor() {
    super('AI work is paused for automatic runs: Testing mode is on (Claude Code subscription, no API credits). Start it from the dashboard to queue it for Claude Code, or switch to Live mode.');
    this.name = 'TestingModeError';
  }
}

const POLL_MS = 4000;

const text = (content: any): string =>
  typeof content === 'string'
    ? content
    : (Array.isArray(content) ? content : [])
        .map((b: any) => (b?.type === 'text' ? b.text : b?.type === 'tool_result' ? `[tool result] ${typeof b.content === 'string' ? b.content : JSON.stringify(b.content)}` : ''))
        .filter(Boolean)
        .join('\n');

// One request answered through the queue. Returns what callClaudeLive returns (text, the assistant
// turn for repair loops, stop reason), so callers cannot tell the difference.
export async function askQueue(hash: string, systemPrompt: string, userMessages: any[], signal: AbortSignal | undefined, opts: any) {
  const messages = userMessages.map((m: any) => ({ role: m.role, content: text(m.content) }));
  // The same request again (a run started again after a restart) reuses its job instead of a new one.
  let job = await prisma.ai_jobs.findFirst({ where: { hash, status: { in: ['waiting', 'answered'] } }, orderBy: { id: 'desc' } });
  if (!job) {
    const firstUser = messages.find((m) => m.role === 'user')?.content || '';
    job = await prisma.ai_jobs.create({
      data: {
        hash,
        feature: String(opts.feature || 'other'),
        model: opts.model || null,
        label: firstUser.replace(/\s+/g, ' ').slice(0, 140),
        web_search: (opts.maxUses ?? 8) > 0,
        system: systemPrompt,
        messages: JSON.stringify(messages),
      },
    });
  }
  const id = job.id;
  for (;;) {
    if (signal?.aborted) {
      await prisma.ai_jobs.updateMany({ where: { id, status: 'waiting' }, data: { status: 'cancelled', answered_at: sqlNow() } });
      throw signal.reason instanceof Error ? signal.reason : new Error('Stopped');
    }
    const row = await prisma.ai_jobs.findUnique({ where: { id } });
    if (!row || row.status === 'cancelled') throw new Error(`Cancelled in the Claude Code queue (job #${id}).`);
    if (row.status === 'answered' || row.status === 'used') {
      await prisma.ai_jobs.update({ where: { id }, data: { status: 'used' } });
      const answer = row.answer || '';
      return {
        text: answer,
        assistantMessages: [{ role: 'assistant', content: answer }],
        stopReason: 'end_turn',
        activity: { part: 0, searches: 0, chars: answer.length, retries: 0, lastEventAt: Date.now(), note: `answered by Claude Code (job #${id})` },
      };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
