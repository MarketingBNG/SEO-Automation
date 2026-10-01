'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Check, Circle, FileText, Loader2, MessageSquarePlus, Paperclip, Send, Square, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { renderMarkdown } from '@/components/shared/article';
import { StatusBadge } from '@/components/shared/status-badge';
import { cn } from 'cn';

const ASSISTANT_SUGGESTIONS = [
  'Optimize a blog for SEO: I will paste it in my next message',
  'Add a banner to the homepage (I will attach the image)',
  'Show my top Search Console queries for the last 28 days',
  'Which pages get impressions but very few clicks?',
  'Check the alt text of images on my latest blog post',
  'What changes have you made to the website so far?',
];

// Same statuses as the old text icons (… ✓ ✕ ⊘ •), drawn with lucide icons.
function ToolStatusIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
  if (status === 'ok') return <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />;
  if (status === 'error') return <X className="size-3.5 text-destructive" />;
  if (status === 'declined') return <Ban className="size-3.5 text-muted-foreground" />;
  return <Circle className="size-2 fill-current text-muted-foreground" />;
}

const MD_CLASSES =
  '[&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:font-semibold [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]';

export function PreviewView({ preview }: { preview: any }) {
  if (!preview) return null;
  const { problem, warning, warnings, changes, context, image, ...rest } = preview;
  const scalars = Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object');
  return (
    <div className="mt-2 space-y-2 text-sm">
      {problem && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">{problem}</div>}
      {warning && <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">{warning}</div>}
      {(warnings || []).map((w: any, i: number) => (
        <div key={i} className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">{w}</div>
      ))}
      {scalars.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {scalars.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</dt>
              <dd className="break-words">{String(v)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image && <img src={image} alt="" className="max-h-64 rounded-md border" />}
      {changes && changes.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-1.5">Field</th><th className="px-3 py-1.5">Now</th><th className="px-3 py-1.5">After</th></tr>
            </thead>
            <tbody className="divide-y">
              {changes.map((c: any, i: number) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 align-top">{c.field}</td>
                  <td className="px-3 py-1.5 align-top text-muted-foreground">{c.before}</td>
                  <td className="px-3 py-1.5 align-top">{c.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {context && (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
          {context.before}
          <mark className="rounded bg-amber-300/60 px-0.5 dark:bg-amber-500/40 dark:text-foreground">⟪ change here ⟫</mark>
          {context.after}
        </pre>
      )}
    </div>
  );
}

export default function AssistantTab({ seed }: { seed: { text: string; nonce: number } | null }) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [conv, setConv] = useState<any>(null);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, any>>({});
  const currentIdRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadList = useCallback(async () => {
    const res = await fetch('/api/assistant/conversations');
    if (res.ok) setConversations(await res.json());
  }, []);

  const loadConv = useCallback(async (id: any) => {
    const res = await fetch(`/api/assistant/conversations?id=${id}`);
    if (res.ok) setConv(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same effect as the old app
    loadList();
  }, [loadList]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conv, live]);

  function openConversation(id: any) {
    if (running) return;
    currentIdRef.current = id;
    setDecisions({});
    setError(null);
    loadConv(id);
  }

  function newChat() {
    if (running) return;
    currentIdRef.current = null;
    setConv(null);
    setDecisions({});
    setError(null);
  }

  function appendLive(kind: string, text: string) {
    setLive((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.kind === kind) return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      return [...prev, { kind, text }];
    });
  }

  function handleEvent(e: any) {
    switch (e.type) {
      case 'conversation':
        currentIdRef.current = e.id;
        break;
      case 'text_delta':
        appendLive('assistant', e.text);
        break;
      case 'progress_start':
        setLive((prev) => [...prev, { kind: 'progress', text: '' }]);
        break;
      case 'progress_delta':
        appendLive('progress', e.text);
        break;
      case 'assistant_turn_end':
        setLive((prev) => [...prev, { kind: 'break' }]);
        break;
      case 'tool_start':
        setLive((prev) => [...prev, { kind: 'tool', toolUseId: e.toolUseId, summary: e.summary, status: 'running' }]);
        break;
      case 'tool_progress':
      case 'notice':
        setLive((prev) => [...prev, { kind: 'progress', text: e.text }]);
        break;
      case 'tool_result':
        setLive((prev) =>
          prev.map((it) =>
            it.kind === 'tool' && it.toolUseId === e.toolUseId
              ? { ...it, status: e.declined ? 'declined' : e.ok ? 'ok' : 'error', detail: e.error }
              : it
          )
        );
        break;
      case 'error':
        setError(e.error);
        break;
      default:
        break;
    }
  }

  async function consume(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() as string;
      for (const line of lines) if (line.trim()) handleEvent(JSON.parse(line));
    }
  }

  async function finishRun() {
    setRunning(false);
    abortRef.current = null;
    if (currentIdRef.current) await loadConv(currentIdRef.current);
    setLive([]);
    loadList();
  }

  async function stream(url: string, body: any, optimisticUser?: any) {
    setRunning(true);
    setError(null);
    setLive(optimisticUser ? [optimisticUser] : []);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      await consume(res);
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      await finishRun();
    }
  }

  async function send(textArg?: string, conversationId?: any) {
    const text = (textArg ?? input).trim();
    if (running || attachments.some((a) => a.uploading)) return;
    const images = attachments.filter((a) => a.kind === 'image' && a.id);
    const docs = attachments.filter((a) => a.kind === 'document');
    if (!text && !images.length && !docs.length) return;
    const docText = docs
      .map((d) => `<attached_document name="${d.filename.replace(/"/g, '')}">\n${d.html}\n</attached_document>`)
      .join('\n\n');
    setInput('');
    setAttachments([]);
    setDecisions({});
    await stream(
      '/api/assistant/chat',
      {
        conversationId: conversationId === undefined ? currentIdRef.current : conversationId,
        message: [text, docText].filter(Boolean).join('\n\n'),
        imageIds: images.map((a) => a.id),
      },
      { kind: 'user', text: [text, ...docs.map((d) => `[Attached: ${d.filename}]`)].filter(Boolean).join('\n'), images: images.map((a) => a.url) }
    );
  }

  useEffect(() => {
    if (!seed?.text) return;
    currentIdRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same effect as the old app
    setConv(null);
    send(seed.text, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  async function submitDecisions(list: any[]) {
    const pending = conv?.pending || [];
    const risky = pending.filter((a: any) => a.risk === 'high' && list.find((d) => d.toolUseId === a.toolUseId && d.approve));
    if (risky.length && !window.confirm(`High-risk change to the live website:\n\n${risky.map((a: any) => `- ${a.summary}`).join('\n')}\n\nApply it now?`)) return;
    setDecisions({});
    await stream('/api/assistant/decide', { conversationId: conv.id, decisions: list });
  }

  function decideOne(action: any, approve: boolean) {
    const next = { ...decisions, [action.toolUseId]: { ...(decisions[action.toolUseId] || {}), approve } };
    setDecisions(next);
    const pending = conv.pending || [];
    if (pending.every((a: any) => next[a.toolUseId] && next[a.toolUseId].approve !== undefined)) {
      submitDecisions(pending.map((a: any) => ({ toolUseId: a.toolUseId, approve: next[a.toolUseId].approve, note: next[a.toolUseId].note })));
    }
  }

  function approveAll(approve: boolean) {
    submitDecisions((conv.pending || []).map((a: any) => ({ toolUseId: a.toolUseId, approve, note: decisions[a.toolUseId]?.note })));
  }

  async function undo(changeId: any, force = false): Promise<void> {
    const res = await fetch('/api/assistant/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changeId, force }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 409 && !force) {
      if (window.confirm(`${json.error}\n\nUndo anyway?`)) return undo(changeId, true);
      return;
    }
    if (!res.ok) {
      setError(json.error || 'Undo failed');
      return;
    }
    if (conv) loadConv(conv.id);
  }

  async function uploadFiles(fileList: FileList | File[] | null) {
    const files = [...(fileList || [])].filter((f) => f.type.startsWith('image/') || /\.docx$/i.test(f.name));
    for (const file of files) {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      setAttachments((prev) => [...prev, { key, filename: file.name, url: preview, uploading: true }]);
      const fd = new FormData();
      fd.append('image', file);
      try {
        const res = await fetch('/api/assistant/upload', { method: 'POST', body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setAttachments((prev) => prev.map((a) => (a.key === key ? { ...a, ...json, url: preview, uploading: false } : a)));
      } catch (err: any) {
        setError(`Could not attach ${file.name}: ${err.message}`);
        setAttachments((prev) => prev.filter((a) => a.key !== key));
      }
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = [...(e.clipboardData?.files || [])];
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      uploadFiles(files);
    }
  }

  const changesById = Object.fromEntries((conv?.changes || []).map((c: any) => [c.id, c]));
  const items = conv?.items || [];
  const pending = !running && conv?.status === 'awaiting_approval' ? conv.pending || [] : [];

  function renderItem(item: any, key: string) {
    if (item.kind === 'user') {
      return (
        <div key={key} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {item.images?.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {item.images.map((src: string, i: number) => <img key={i} src={src} alt="Attached" className="max-h-40 rounded-lg" />)}
            </div>
          )}
          {item.text && <div className="whitespace-pre-wrap break-words">{item.text}</div>}
        </div>
      );
    }
    if (item.kind === 'assistant') {
      return (
        <div
          key={key}
          className={cn('max-w-[92%] rounded-2xl rounded-bl-sm border bg-muted/40 px-4 py-2.5 text-sm break-words', MD_CLASSES)}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
        />
      );
    }
    if (item.kind === 'progress') {
      return item.text ? <div key={key} className="pl-1 text-xs whitespace-pre-wrap text-muted-foreground italic">{item.text}</div> : null;
    }
    if (item.kind === 'tool') {
      const change: any = item.changeId ? changesById[item.changeId] : null;
      return (
        <div
          key={key}
          className={cn(
            'flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm',
            item.status === 'error' && 'border-destructive/40',
          )}
        >
          <ToolStatusIcon status={item.status} />
          <span className="min-w-0 flex-1">{item.summary}</span>
          {item.status === 'declined' && <StatusBadge status="pending">declined</StatusBadge>}
          {item.status === 'error' && item.detail && <span className="w-full text-xs text-destructive">{item.detail}</span>}
          {change && change.status === 'applied' && change.undoable ? (
            <Button variant="outline" size="xs" onClick={() => undo(change.id)}><Undo2 />Undo</Button>
          ) : null}
          {change && change.status === 'undone' && <StatusBadge status="pending">undone</StatusBadge>}
        </div>
      );
    }
    return null;
  }

  return (
    <div className="grid gap-4 lg:h-[calc(100svh-7.5rem)] lg:grid-cols-[260px_1fr]">
      <aside className="flex flex-col gap-3 rounded-xl border bg-card p-3 lg:min-h-0">
        <Button onClick={newChat} disabled={running} className="w-full">
          <MessageSquarePlus />
          New chat
        </Button>
        <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto lg:max-h-none lg:flex-1">
          {conversations.map((c) => (
            <button
              type="button"
              key={c.id}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted',
                conv?.id === c.id && 'bg-muted font-medium',
              )}
              onClick={() => openConversation(c.id)}
              title={c.title}
            >
              {c.status === 'awaiting_approval' && <span className="size-2 shrink-0 rounded-full bg-amber-500" title="Waiting for your approval" />}
              <span className="truncate">{c.title || 'Untitled'}</span>
            </button>
          ))}
          {conversations.length === 0 && <p className="px-2 text-sm text-muted-foreground">No conversations yet.</p>}
        </div>
      </aside>

      <section
        className="flex min-h-[70svh] flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          uploadFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" ref={scrollRef}>
          {!conv && live.length === 0 && (
            <div className="mx-auto my-auto max-w-2xl py-8 text-center">
              <h3 className="text-xl font-semibold">What should we work on?</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Ask about your SEO data, or tell me what to change on usaindiacfo.com. Anything that changes the
                website waits for your approval first, and every change can be undone.
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {ASSISTANT_SUGGESTIONS.map((s) => (
                  <button
                    type="button"
                    key={s}
                    className="rounded-lg border bg-background px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
                    onClick={() => setInput(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {items.map((item: any, i: number) => renderItem(item, `c${i}`))}
          {live.map((item, i) => renderItem(item, `l${i}`))}
          {running && (
            <div className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Working
            </div>
          )}

          {pending.length > 0 && (
            <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm">Waiting for your approval</strong>
                {pending.length > 1 && (
                  <div className="flex gap-2">
                    <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-600/90" onClick={() => approveAll(true)}>Approve all</Button>
                    <Button size="sm" variant="outline" onClick={() => approveAll(false)}>Decline all</Button>
                  </div>
                )}
              </div>
              {pending.map((a: any) => (
                <div
                  key={a.toolUseId}
                  className={cn(
                    'rounded-lg border border-l-4 bg-card p-3',
                    a.risk === 'high' ? 'border-l-destructive' : a.risk === 'medium' ? 'border-l-orange-500' : 'border-l-emerald-500',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <strong className="text-sm">{a.summary}</strong>
                    <StatusBadge status={a.risk === 'high' ? 'failed' : a.risk === 'medium' ? 'generating' : 'approved'}>
                      {a.risk} risk
                    </StatusBadge>
                  </div>
                  <PreviewView preview={a.preview} />
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Exact values</summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{JSON.stringify(a.input, null, 2)}</pre>
                  </details>
                  <Input
                    className="mt-2"
                    type="text"
                    placeholder="Optional note, e.g. what to change instead"
                    value={decisions[a.toolUseId]?.note || ''}
                    onChange={(e) =>
                      setDecisions((prev) => ({ ...prev, [a.toolUseId]: { ...(prev[a.toolUseId] || {}), note: e.target.value } }))
                    }
                  />
                  <div className="mt-2 flex gap-2">
                    <Button className="bg-emerald-600 text-white hover:bg-emerald-600/90" onClick={() => decideOne(a, true)} disabled={decisions[a.toolUseId]?.approve !== undefined}>
                      <Check />
                      {decisions[a.toolUseId]?.approve === true ? 'Approved' : 'Approve'}
                    </Button>
                    <Button variant="outline" onClick={() => decideOne(a, false)} disabled={decisions[a.toolUseId]?.approve !== undefined}>
                      <X />
                      {decisions[a.toolUseId]?.approve === false ? 'Declined' : 'Decline'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="border-t bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t px-3 pt-3">
            {attachments.map((a) => (
              <div key={a.key} className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-1 text-xs">
                {a.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.filename} className="size-8 rounded object-cover" />
                ) : (
                  <span className="flex size-8 items-center justify-center rounded bg-primary/10 text-primary" title="DOCX"><FileText className="size-4" /></span>
                )}
                <span className="max-w-48 truncate">{a.uploading ? 'Uploading…' : `${a.filename}${a.truncated ? ' (long, first part only)' : ''}`}</span>
                {!a.uploading && (
                  <Button variant="ghost" size="icon-xs" aria-label="Remove attachment" onClick={() => setAttachments((prev) => prev.filter((x) => x.key !== a.key))}>
                    <X />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t p-3 sm:flex-row sm:items-end">
          <Textarea
            rows={2}
            className="max-h-48 min-h-12 flex-1 resize-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={pending.length ? 'Approve or decline above, or type a different instruction' : 'Message the assistant. Attach, paste or drop images and Word documents.'}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.docx"
            multiple
            className="hidden"
            onChange={(e) => {
              uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={running} title="Attach an image or a Word document">
              <Paperclip />
              Attach
            </Button>
            {running ? (
              <Button variant="destructive" onClick={() => abortRef.current?.abort()}>
                <Square />
                Stop
              </Button>
            ) : (
              <Button onClick={() => send()} disabled={!input.trim() && !attachments.some((a) => !a.uploading)}>
                <Send />
                Send
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
