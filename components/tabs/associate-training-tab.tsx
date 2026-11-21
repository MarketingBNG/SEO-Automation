'use client';

// Training: three short lessons a day (Technical knowledge, Know UIC, Marketing skills) to read or
// watch, then the tests (the daily one, and an unannounced surprise test one weekday a week), then a
// game round built from the same lessons. Everyone but the admin takes it; the admin and managers
// also see the team report (marks, trend, levels, strengths and weak topics, CSV download).
import { onScreen } from '@/components/shared/on-screen';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, Download, Gamepad2, GraduationCap, Loader2, Pause, Play, RefreshCw, SkipBack, SkipForward, Trophy, Video, XCircle } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SafeHtml, safeHref } from '@/components/shared/article';

const fmtDay = (d?: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }) : '');
const fmtDur = (ms?: number | null) => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};
const parseUtcMs = (s?: string | null) => {
  const ms = Date.parse(String(s || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : null;
};
const durStr = (a?: string | null, b?: string | null) => {
  const x = parseUtcMs(a);
  const y = parseUtcMs(b);
  return x !== null && y !== null && y >= x ? fmtDur(y - x) : null;
};
const safeParse = (s: any) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
// AI-use signals worth a flag: any paste, 3 or more tab-switches, or a minute or more away.
const flagged = (sig: any) => !!sig && (sig.pastes > 0 || sig.switches >= 3 || sig.awayMs >= 60000);
const post = async (body: any) => {
  const res = await fetch('/api/associate-training', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ error: `The server did not answer properly (HTTP ${res.status}).` }));
  if (!res.ok) throw new Error(j.error || 'Failed');
  return j;
};

// ---------- Watch: slide walkthrough and videos ----------

function FlowDiagram({ steps }: { steps: string[] }) {
  const h = 46;
  return (
    <svg viewBox={`0 0 320 ${steps.length * (h + 18)}`} className="mx-auto w-full max-w-sm" role="img" aria-label={steps.join(', then ')}>
      {steps.map((s, i) => (
        <g key={i} transform={`translate(10 ${i * (h + 18)})`}>
          <rect width="300" height={h} rx="8" className="fill-primary/10 stroke-primary" strokeWidth="1.5" />
          <text x="150" y={h / 2 + 4} textAnchor="middle" className="fill-foreground text-[11px]">
            {i + 1}. {s.length > 48 ? `${s.slice(0, 46)}…` : s}
          </text>
          {i < steps.length - 1 && <path d={`M150 ${h} v14 m-5 -6 l5 6 l5 -6`} className="stroke-primary" fill="none" strokeWidth="1.5" />}
        </g>
      ))}
    </svg>
  );
}

function SlidePlayer({ slides }: { slides: any[] }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => (i < slides.length - 1 ? setI(i + 1) : setPlaying(false)), 7000);
    return () => clearTimeout(t);
  }, [playing, i, slides.length]);
  if (!slides?.length) return null;
  const s = slides[Math.min(i, slides.length - 1)];
  return (
    <div className="space-y-2">
      <div className="flex min-h-56 flex-col justify-center rounded-xl border bg-gradient-to-br from-primary/10 to-transparent p-5">
        <div className="text-xs text-muted-foreground">
          Slide {i + 1} of {slides.length}
        </div>
        <div className="mt-1 text-lg font-semibold">{s.heading}</div>
        {s.flow?.length ? (
          <div className="mt-3">
            <FlowDiagram steps={s.flow} />
          </div>
        ) : (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {s.points.map((p: string, k: number) => (
              <li key={k}>{p}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button size="sm" variant="outline" aria-label="Previous slide" disabled={i === 0} onClick={() => setI(i - 1)}>
          <SkipBack className="size-4" />
        </Button>
        <Button size="sm" onClick={() => setPlaying(!playing)}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button size="sm" variant="outline" aria-label="Next slide" disabled={i >= slides.length - 1} onClick={() => setI(i + 1)}>
          <SkipForward className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// YouTube only, through the privacy-enhanced embed the server checked; never auto-plays.
function Videos({ videos }: { videos: any[] }) {
  if (!videos?.length) return <p className="text-xs text-muted-foreground">No checked video for this topic today.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {videos
        .filter((v) => /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}\?rel=0$/.test(v.embed))
        .map((v) => (
          <div key={v.id} className="space-y-1">
            <div className="aspect-video overflow-hidden rounded-lg border">
              <iframe className="size-full" src={v.embed} title={v.title} loading="lazy" allow="encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
            </div>
            <div className="text-xs">
              {v.title}
              {v.channel && <span className="text-muted-foreground"> · {v.channel}</span>}
            </div>
          </div>
        ))}
    </div>
  );
}

// ---------- Game round ----------

function GameRound({ lesson, onPlayed }: { lesson: any; onPlayed: (r: any) => void }) {
  const g = lesson.games;
  const [match, setMatch] = useState<number[]>(() => (g.match ? g.match.terms.map(() => -1) : []));
  const [order, setOrder] = useState<number[]>(() => (g.order ? g.order.shuffled.map((_: any, i: number) => i) : []));
  const [cases, setCases] = useState<number[]>(() => g.cases.map(() => -1));
  const [blanks, setBlanks] = useState<number[]>(() => g.blanks.map(() => -1));
  const [lightning, setLightning] = useState<(boolean | null)[]>(() => g.lightning.map(() => null));
  const [started, setStarted] = useState<number | null>(null);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const empty = !g.match && !g.order && !g.cases.length && !g.blanks.length && !g.lightning.length;
  if (empty) return <p className="text-sm text-muted-foreground">No game for this lesson.</p>;
  const move = (k: number, d: number) => setOrder((o) => {
    const n = [...o];
    const j = k + d;
    if (j < 0 || j >= n.length) return o;
    [n[k], n[j]] = [n[j], n[k]];
    return n;
  });
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const seconds = started ? Math.round((Date.now() - started) / 1000) : 0;
      const r = await post({ action: 'game', lessonId: lesson.id, answers: { match, order, cases, blanks, lightning, seconds } });
      setResult(r);
      onPlayed(r);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  const pick = (arr: number[], set: (v: number[]) => void, i: number, v: number) => set(arr.map((x, k) => (k === i ? v : x)));
  return (
    <div className="space-y-4 text-sm">
      {g.match && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="font-semibold">Match each term to its meaning</div>
          {g.match.terms.map((t: string, i: number) => (
            <label key={i} className="block space-y-1">
              <span className="font-medium">{t}</span>
              <select className="w-full rounded-md border bg-background p-1.5" value={match[i]} onChange={(e) => pick(match, setMatch, i, Number(e.target.value))}>
                <option value={-1}>Choose the meaning</option>
                {g.match.definitions.map((d: string, k: number) => (
                  <option key={k} value={k}>{d}</option>
                ))}
              </select>
              {result && <span className={g.match.answer[i] === match[i] ? 'text-emerald-600' : 'text-red-600'}>{g.match.answer[i] === match[i] ? 'Right' : `Right answer: ${g.match.definitions[g.match.answer[i]]}`}</span>}
            </label>
          ))}
        </div>
      )}
      {g.order && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="font-semibold">{g.order.title}: put the steps in order</div>
          <ol className="space-y-1">
            {order.map((k, pos) => (
              <li key={k} className="flex items-center gap-2 rounded-md border p-1.5">
                <span className="w-5 text-muted-foreground">{pos + 1}.</span>
                <span className="flex-1">{g.order.shuffled[k]}</span>
                <Button size="icon" variant="ghost" aria-label="Move up" disabled={pos === 0} onClick={() => move(pos, -1)}><ArrowUp className="size-4" /></Button>
                <Button size="icon" variant="ghost" aria-label="Move down" disabled={pos === order.length - 1} onClick={() => move(pos, 1)}><ArrowDown className="size-4" /></Button>
              </li>
            ))}
          </ol>
          {result && <div className="text-xs">Right order: {g.order.answer.map((k: number) => g.order.shuffled[k]).join(' → ')}</div>}
        </div>
      )}
      {g.cases.map((c: any, i: number) => (
        <div key={i} className="space-y-1 rounded-lg border p-3">
          <div className="font-semibold">Client case {i + 1}</div>
          <div>{c.scenario}</div>
          {c.options.map((o: string, k: number) => (
            <label key={k} className="flex items-start gap-2">
              <input type="radio" className="mt-1" name={`case-${lesson.id}-${i}`} checked={cases[i] === k} onChange={() => pick(cases, setCases, i, k)} />
              {o}
            </label>
          ))}
          {result && <div className={cases[i] === c.answer ? 'text-emerald-600' : 'text-red-600'}>{cases[i] === c.answer ? 'Right. ' : `Right answer: ${c.options[c.answer]}. `}<span className="text-muted-foreground">{c.explain}</span></div>}
        </div>
      ))}
      {g.blanks.length > 0 && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="font-semibold">Fill in the blank</div>
          {g.blanks.map((b: any, i: number) => (
            <div key={i} className="space-y-1">
              <div>{b.sentence}</div>
              <select className="rounded-md border bg-background p-1.5" value={blanks[i]} onChange={(e) => pick(blanks, setBlanks, i, Number(e.target.value))}>
                <option value={-1}>Choose</option>
                {b.options.map((o: string, k: number) => (
                  <option key={k} value={k}>{o}</option>
                ))}
              </select>
              {result && <span className={`ml-2 ${blanks[i] === b.answer ? 'text-emerald-600' : 'text-red-600'}`}>{blanks[i] === b.answer ? 'Right' : b.options[b.answer]}</span>}
            </div>
          ))}
        </div>
      )}
      {g.lightning.length > 0 && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="font-semibold">Lightning round: true or false? Finish within 60 seconds for a bonus point each.</div>
          {!started ? (
            <Button size="sm" onClick={() => setStarted(Date.now())}>Start the lightning round</Button>
          ) : (
            g.lightning.map((q: any, i: number) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="flex-1">{q.statement}</span>
                {[true, false].map((v) => (
                  <Button key={String(v)} size="sm" variant={lightning[i] === v ? 'default' : 'outline'} onClick={() => setLightning(lightning.map((x, k) => (k === i ? v : x)))}>
                    {v ? 'True' : 'False'}
                  </Button>
                ))}
                {result && <span className={lightning[i] === q.answer ? 'text-emerald-600' : 'text-red-600'}>{lightning[i] === q.answer ? 'Right' : q.answer ? 'It was true' : 'It was false'}</span>}
              </div>
            ))
          )}
        </div>
      )}
      {err && <div className="text-red-600">{err}</div>}
      {result ? (
        <div className="flex items-center gap-2 rounded-lg bg-muted p-3 font-medium">
          <Trophy className="size-4 text-amber-500" /> {result.points} of {result.max} points. Total {result.totalPoints} points, {result.streak} day(s) in a row.
        </div>
      ) : (
        <Button onClick={submit} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Finish the game
        </Button>
      )}
    </div>
  );
}

// ---------- A lesson: read, watch, play ----------

function Lesson({ l, open: startOpen, mine, testsOpen, onChange }: { l: any; open?: boolean; mine?: boolean; testsOpen?: boolean; onChange?: () => void }) {
  const [open, setOpen] = useState(Boolean(startOpen));
  const [view, setView] = useState<'read' | 'watch' | 'game'>('read');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Record when the lesson was first opened (only for the person's own, still-unread lesson): the
  // report shows read time minus this. The server keeps the earliest open and ignores the rest.
  useEffect(() => {
    if (open && mine && !l.readAt) post({ action: 'open', lessonId: l.id }).catch(() => {});
  }, [open, mine, l.id, l.readAt]);
  async function read() {
    setBusy(true);
    setErr(null);
    try {
      await post({ action: 'read', lessonId: l.id });
      window.dispatchEvent(new Event('training-updated'));
      onChange?.();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-lg border">
      <button className="flex w-full items-center justify-between gap-2 p-3 text-left" onClick={() => setOpen(!open)}>
        <span className="font-medium">
          {l.trackLabel && <span className="mr-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{l.trackLabel}</span>}
          {l.title} <span className="text-xs font-normal text-muted-foreground">{fmtDay(l.day)} · level {l.level}</span>
          {mine && l.readAt && <CheckCircle2 className="ml-1 inline size-4 text-emerald-600" aria-label="Read" />}
        </span>
        <ChevronDown className={`size-4 shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t p-3">
          {mine && l.games && (
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant={view === 'read' ? 'default' : 'outline'} onClick={() => setView('read')}>Read</Button>
              <Button size="sm" variant={view === 'game' ? 'default' : 'outline'} onClick={() => setView('game')}><Gamepad2 className="size-4" />Game</Button>
            </div>
          )}
          {view === 'read' && (
            <>
              <SafeHtml className="prose prose-sm max-w-none dark:prose-invert" html={l.content_html} />
              {l.terms?.length > 0 && (
                <div className="rounded-md border bg-muted/50 p-2 text-sm">
                  <div className="mb-1 font-medium">Quick notes</div>
                  <ul className="space-y-0.5">
                    {l.terms.map((t: any, i: number) => (
                      <li key={i}><span className="font-medium">{t.term}:</span> <span className="text-muted-foreground">{t.definition}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              {l.sources?.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Sources:{' '}
                  {l.sources.map((s: any, i: number) => (
                    <a key={i} href={safeHref(s.url)} target="_blank" rel="noreferrer" className="mr-2 underline">
                      {s.title}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
          {view === 'game' &&
            (l.played ? (
              <div className="space-y-2">
                <p className="text-sm">Best round on this lesson: {l.played.points} of {l.played.max_points} points. Play again to beat it.</p>
                <GameRound lesson={l} onPlayed={() => onChange?.()} />
              </div>
            ) : (
              <GameRound lesson={l} onPlayed={() => onChange?.()} />
            ))}
          {mine && !l.readAt && (
            <Button onClick={read} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} I have read today&apos;s lesson
            </Button>
          )}
          {mine && l.readAt && <div className="text-xs text-emerald-700 dark:text-emerald-400">Marked read {l.readAt} UTC.</div>}
          {!mine && (l.openedAt || l.readAt) && (
            <div className="text-xs text-muted-foreground">
              {l.openedAt ? `Opened ${l.openedAt} UTC` : 'Open time not recorded'}
              {l.readAt ? ` · read ${l.readAt} UTC` : ' · not marked read yet'}
              {l.readMs ? ` · took ${fmtDur(l.readMs)}` : ''}
            </div>
          )}
          {err && <div className="text-sm text-red-600">{err}</div>}
        </div>
      )}
    </div>
  );
}

// meta: the admin or a manager is reviewing, so show how long it took, the AI-use signals, and the
// trail of what was picked and changed. A person reviewing their own test does not see these.
function Review({ test, meta }: { test: any; meta?: boolean }) {
  const sig = meta ? safeParse(test.signals) : null;
  const isFlag = flagged(sig);
  const trail: Record<number, { o: number; at: number }[]> = {};
  if (meta) for (const e of safeParse(test.answer_log) || []) trail[e.q] = e.picks || [];
  const time = meta ? durStr(test.opened_at, test.submitted_at) || (sig?.ms ? fmtDur(sig.ms) : null) : null;
  // Typed answers and their AI grades (the result object carries objects; the review endpoint strings).
  const wGrades = typeof test.written_grades === 'string' ? safeParse(test.written_grades) : test.writtenGrades || null;
  const wAns = typeof test.written === 'string' ? safeParse(test.written) : test.written || null;
  return (
    <div className="space-y-3">
      {meta && (
        <div className={`rounded-md border p-2 text-xs ${isFlag ? 'border-red-500/50 bg-red-500/10' : 'bg-muted'}`}>
          <div>Time taken: {time || 'unknown'}</div>
          {sig ? (
            <div className={isFlag ? 'font-medium text-red-700 dark:text-red-400' : 'text-muted-foreground'}>
              Pastes: {sig.pastes} · Left the tab: {sig.switches} time(s){sig.awayMs ? ` · away ${fmtDur(sig.awayMs)}` : ''}{isFlag ? ' · possible outside help, check the answers' : ''}
            </div>
          ) : (
            <div className="text-muted-foreground">No AI-use signals recorded (older test, or taken before this was added).</div>
          )}
        </div>
      )}
      {test.questions.map((q: any, i: number) => {
        if (q.kind === 'written') {
          const g = wGrades?.[q.id];
          const a = wAns?.[q.id];
          return (
            <div key={q.id} className="rounded-lg border p-3 text-sm">
              <div className="flex gap-2 font-medium">
                {g ? (g.score >= 1 ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : g.score >= 0.5 ? <CheckCircle2 className="size-4 shrink-0 text-amber-500" /> : <XCircle className="size-4 shrink-0 text-red-600" />) : <span className="size-4 shrink-0" />}
                {i + 1}. {q.q} <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">Typed</span>
              </div>
              <div className="mt-1 space-y-1 pl-6">
                <div className="whitespace-pre-wrap"><span className="text-muted-foreground">{meta ? 'Their' : 'Your'} answer:</span> {a?.text ? a.text : <span className="text-muted-foreground">not answered</span>}</div>
                {g && <div className={g.score >= 1 ? 'text-emerald-700 dark:text-emerald-400' : g.score >= 0.5 ? 'text-amber-700 dark:text-amber-400' : 'text-red-600'}>AI score: {g.score} of 1{g.reason ? ` — ${g.reason}` : ''}</div>}
                <div className="text-muted-foreground"><span className="font-medium">Model answer:</span> {q.model}</div>
                {meta && a && <div className="text-xs text-muted-foreground">Typed in {fmtDur(a.ms) ?? '—'} · {a.keystrokes ?? 0} keystrokes · {a.backspaces ?? 0} backspaces</div>}
              </div>
            </div>
          );
        }
        const picked = test.answers?.[q.id];
        const right = picked !== undefined && Number(picked) === q.answer;
        const picks = trail[i] || [];
        return (
          <div key={q.id} className="rounded-lg border p-3 text-sm">
            <div className="flex gap-2 font-medium">
              {right ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <XCircle className="size-4 shrink-0 text-red-600" />}
              {i + 1}. {q.q}
            </div>
            <div className="mt-1 pl-6">
              {!right && <div className="text-red-600">{meta ? 'Their' : 'Your'} answer: {picked !== undefined ? q.options[picked] : 'not answered'}</div>}
              <div className="text-emerald-700 dark:text-emerald-400">Right answer: {q.options[q.answer]}</div>
              {meta && picks.length > 1 && (
                <div className="text-xs text-amber-700 dark:text-amber-400">Changed answer: {picks.map((p) => q.options[p.o] ?? '?').join(' → ')}</div>
              )}
              {q.explain && <div className="text-muted-foreground">{q.explain}</div>}
              {q.source && (
                <a href={safeHref(q.source)} target="_blank" rel="noreferrer" className="text-xs underline">
                  Source
                </a>
              )}
              {!right && <div className="text-xs text-muted-foreground">This question will be asked again in two days.</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Test({ test, onDone }: { test: any; onDone: () => void }) {
  // Ticks are kept by question number, so a question with a missing or repeated id still keeps its own
  // tick; they are turned into { questionId: option } only when the test is sent.
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const writtenQs = test.questions.filter((q: any) => q.kind === 'written');
  const answered = Object.keys(picked).length + writtenQs.filter((q: any) => String(typed[q.id] || '').trim()).length;
  // Timing and AI-use signals for the report: when the test was started, every option picked and
  // re-picked, how many pastes, and how often the person left the tab (and for how long).
  const started = useRef(Date.now());
  const log = useRef<Record<number, { o: number; at: number }[]>>({});
  const sig = useRef({ pastes: 0, switches: 0, awayMs: 0, awaySince: 0 });
  const saveTimer = useRef<any>(null);
  // Per typed question: how many keys, how many backspaces, and when typing started.
  const wstats = useRef<Record<string, { keystrokes: number; backspaces: number; firstAt: number }>>({});
  function typeAns(id: string, v: string) {
    setTyped((t) => ({ ...t, [id]: v }));
  }
  function keyStat(id: string, key: string) {
    const s = (wstats.current[id] ||= { keystrokes: 0, backspaces: 0, firstAt: Date.now() });
    s.keystrokes++;
    if (key === 'Backspace' || key === 'Delete') s.backspaces++;
  }
  useEffect(() => {
    post({ action: 'start', testId: test.id }).catch(() => {});
    const away = () => { sig.current.switches++; sig.current.awaySince = Date.now(); };
    const back = () => { if (sig.current.awaySince) { sig.current.awayMs += Date.now() - sig.current.awaySince; sig.current.awaySince = 0; } };
    const vis = () => (document.hidden ? away() : back());
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('blur', away); window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', vis); clearTimeout(saveTimer.current); };
  }, [test.id]);
  function pick(i: number, k: number) {
    (log.current[i] ||= []).push({ o: k, at: Date.now() - started.current });
    setPicked((p) => {
      const next = { ...p, [i]: k };
      // Save what is picked so far (debounced) so the admin/manager can watch the test live.
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => post({ action: 'progress', testId: test.id, picked: next }).catch(() => {}), 800);
      return next;
    });
  }
  async function submit() {
    if (answered < test.questions.length && !confirm('Some questions are not answered. Submit anyway?')) return;
    const answers: Record<string, number> = {};
    test.questions.forEach((q: any, i: number) => {
      if (q.kind !== 'written' && picked[i] !== undefined) answers[q.id] = picked[i];
    });
    const written: Record<string, any> = {};
    for (const q of writtenQs) {
      const s = wstats.current[q.id] || { keystrokes: 0, backspaces: 0, firstAt: 0 };
      written[q.id] = { text: typed[q.id] || '', keystrokes: s.keystrokes, backspaces: s.backspaces, ms: s.firstAt ? Date.now() - s.firstAt : 0 };
    }
    const logArr = Object.entries(log.current).map(([q, picks]) => ({ q: Number(q), picks }));
    const signals = { pastes: sig.current.pastes, switches: sig.current.switches, awayMs: sig.current.awayMs + (sig.current.awaySince ? Date.now() - sig.current.awaySince : 0), ms: Date.now() - started.current };
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/associate-training', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', testId: test.id, answers, log: logArr, signals, written }) });
      const j = await res.json().catch(() => ({ error: `The server did not answer properly (HTTP ${res.status}).` }));
      if (!res.ok) throw new Error(j.error);
      setResult(j);
      window.dispatchEvent(new Event('training-updated'));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (result)
    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-3 font-medium">
          Test submitted. Thank you.{result.levelUp && ' Well done, you moved up a level. Your next lessons are a step harder.'}
          {result.levelDown && ' Your level was adjusted so the lessons fit you. Keep going and you will move up again.'}
        </div>
        <Button onClick={onDone}>Close</Button>
      </div>
    );
  return (
    <div className="space-y-4" onPaste={() => { sig.current.pastes++; }}>
      {test.questions.map((q: any, i: number) => (
        <div key={i} className="space-y-2 rounded-lg border p-3">
          <div className="text-sm font-medium">
            {i + 1}. {q.q} {q.kind === 'written' && <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">Write your answer</span>} {q.repeat && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Asked again</span>}
          </div>
          {q.kind === 'written' ? (
            <textarea
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              rows={4}
              value={typed[q.id] || ''}
              placeholder="Type your answer in your own words."
              onKeyDown={(e) => keyStat(q.id, e.key)}
              onChange={(e) => typeAns(q.id, e.target.value)}
            />
          ) : (
            q.options.map((o: string, k: number) => (
              <label key={k} className={`flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-sm ${picked[i] === k ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted'}`}>
                <input type="radio" name={`test-${test.id}-q${i}`} className="mt-1 size-4 accent-primary" checked={picked[i] === k} onChange={() => pick(i, k)} />
                {o}
              </label>
            ))
          )}
        </div>
      ))}
      <div className="text-sm text-muted-foreground">
        {answered} of {test.questions.length} answered
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <Button onClick={submit} disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />} Submit the test
      </Button>
    </div>
  );
}

// The questions of a test someone else will take: readable, not answerable.
function TestPreview({ test }: { test: any }) {
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">Only the person in training can take this test.</div>
      {test.questions.map((q: any, i: number) => (
        <div key={q.id} className="rounded-lg border p-3 text-sm">
          <div className="font-medium">
            {i + 1}. {q.q} {q.kind === 'written' && <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">Typed answer</span>} {q.repeat && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Asked again</span>}
          </div>
          {q.kind === 'written' ? (
            <div className="mt-1 pl-6 text-xs text-muted-foreground italic">The person writes their own answer; the AI grades it.</div>
          ) : (
          <ul className="mt-1 list-disc pl-6 text-muted-foreground">
            {q.options.map((o: string, k: number) => (
              <li key={k}>{o}</li>
            ))}
          </ul>
          )}
        </div>
      ))}
    </div>
  );
}

// Live test view: tests being taken right now, refreshed every few seconds. The admin/manager sees
// each person's current answers as they tick them. The person never sees this panel.
function LiveTests() {
  const [live, setLive] = useState<any[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const res = await fetch('/api/associate-training?live=1');
        const j = await res.json().catch(() => ({}));
        if (on && res.ok) setLive(j.live || []);
      } catch {}
    };
    load();
    const t = setInterval(() => onScreen('tab-associates') && load(), 5000);
    return () => { on = false; clearInterval(t); };
  }, []);
  if (!live.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="inline-block size-2 animate-pulse rounded-full bg-red-500" /> Live now ({live.length})
        </CardTitle>
        <CardDescription>Tests being taken right now. Updates every few seconds. The person does not see this.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {live.map((t) => (
          <div key={t.id} className="rounded-lg border">
            <button className="flex w-full items-center justify-between gap-2 p-3 text-left" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
              <span className="text-sm font-medium">
                {t.name} <span className="font-normal text-muted-foreground">· {t.kind === 'surprise' ? 'Surprise test' : 'Daily test'} · {t.answered}/{t.total} answered</span>
              </span>
              <ChevronDown className={`size-4 shrink-0 transition ${openId === t.id ? 'rotate-180' : ''}`} />
            </button>
            {openId === t.id && (
              <div className="space-y-3 border-t p-3">
                {t.questions.map((q: any, i: number) => (
                  <div key={i} className="text-sm">
                    <div className="font-medium">{i + 1}. {q.q}</div>
                    <ul className="mt-1 space-y-1">
                      {q.options.map((o: string, k: number) => (
                        <li key={k} className={`rounded px-2 py-1 ${q.picked === k ? 'bg-primary/15 font-medium' : 'text-muted-foreground'}`}>
                          {q.picked === k ? '● ' : '○ '}{o}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// The admin's or manager's remarks on a person (weekend review). The person does not see these.
function Remarks({ email, remarks, onSaved }: { email: string; remarks: any[]; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await post({ action: 'remark', email, text });
      setText('');
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Remarks</CardTitle>
        <CardDescription>Weekend review. Their level, recent average and whether they moved up this week are saved with each note automatically. The person does not see these; the admin and their manager do.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <textarea className="w-full rounded border bg-background px-2 py-1 text-sm" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Strong week on Know UIC, needs work on marketing compliance." />
          {err && <div className="text-sm text-red-600">{err}</div>}
          <Button size="sm" onClick={add} disabled={busy || !text.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />} Add remark
          </Button>
        </div>
        {remarks?.length ? (
          <ul className="space-y-2">
            {remarks.map((r) => (
              <li key={r.id} className="rounded-lg border p-2 text-sm">
                <div className="text-xs text-muted-foreground">{r.authorName || r.author} · {r.at} UTC{r.week ? ` · week of ${fmtDay(r.week)}` : ''}</div>
                <div className="mt-0.5 text-xs">
                  {r.level != null && <span>Level {r.level}</span>}
                  {r.percent != null && <span> · {r.percent}% recent average</span>}
                  {r.levelUp && <span className="ml-1 rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">moved up this week</span>}
                </div>
                <div className="mt-1 whitespace-pre-wrap">{r.text}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-muted-foreground">No remarks yet.</div>
        )}
      </CardContent>
    </Card>
  );
}

// One person's training page. readOnly: the admin or a manager looking at someone's page.
function PersonPage({ p, data, readOnly, onDone, openReview }: { p: any; data: any; readOnly: boolean; onDone: () => void; openReview: (id: number) => void }) {
  const lvl = data.levels[p.profile.level];
  const who = readOnly ? p.name || p.email : 'you';
  const testsOpen = (p.tests || []).length > 0;
  const unreadToday = p.gate?.unread?.length || 0;

  // A trainee taking a test: focus mode. Only the test shows, no lessons, notes, results or stats, so
  // they answer from memory. If a lesson is still unread today (rare), both show so they are not locked.
  if (!readOnly && testsOpen && unreadToday === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s test</CardTitle>
          <CardDescription>Answer from memory. Your lessons and notes are hidden while the test is open.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {p.tests.map((t: any) => (
            <div key={t.id} className="space-y-2">
              {t.kind === 'surprise' && <div className="rounded-md bg-violet-100 p-2 text-sm font-semibold text-violet-900 dark:bg-violet-900/40 dark:text-violet-200">Surprise test! Questions from this week&apos;s lessons and earlier misses.</div>}
              <Test key={t.id} test={t} onDone={onDone} />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="size-5" /> {readOnly ? `${p.name || p.email}` : 'My training'}
          </CardTitle>
          <CardDescription>
            {readOnly
              ? 'This is the page they see, read only.'
              : 'Read each lesson and press "I have read today\'s lesson". On test days a test opens here. Until today\'s training is done, the rest of the dashboard stays locked.'}
          </CardDescription>
          <CardAction>
            <div className="text-right text-sm">
              <div className="font-semibold">Level {p.profile.level} of 5{p.profile.audience === 'manager' ? ' (manager)' : ''}</div>
              <div className="text-xs text-muted-foreground">{lvl?.questions} technical questions a lesson</div>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          {readOnly && (
            <div>
              Levels follow recent scores: an average of {data.thresholds.up}% or more over the last {data.thresholds.window} tests (without a falling trend) moves up; under {data.thresholds.down}% moves down.
              {p.dueAgain > 0 && ` ${p.dueAgain} question(s) waiting to be asked again.`}
            </div>
          )}
          {!readOnly && !p.profile.active && <div>Training is paused for you by the admin.</div>}
          <div className="flex flex-wrap items-center gap-3 text-foreground">
            <span className="inline-flex items-center gap-1"><Trophy className="size-4 text-amber-500" /> {p.profile.points} points</span>
            <span>{p.profile.gameStreak} game day(s) in a row</span>
            {p.profile.badge && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{p.profile.badge}</span>}
          </div>
          {readOnly && p.levelHistory?.length > 0 && <div className="text-xs">Level changes: {p.levelHistory.map((h: any) => `${h.created_at.slice(0, 10)} ${h.from_level}→${h.to_level}`).join(', ')}</div>}
          {!readOnly && p.gate?.notice && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-foreground">{p.gate.notice}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s lessons</CardTitle>
          <CardDescription>Read (or watch) each one and press &quot;I have read today&apos;s lesson&quot;.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {p.lessons?.length ? p.lessons.map((l: any) => <Lesson key={l.id} l={l} open={!readOnly && !l.readAt} mine={!readOnly} testsOpen={testsOpen} onChange={onDone} />) : <div className="text-sm text-muted-foreground">No lessons today (a test day or a rest day), or they are still being prepared.</div>}
        </CardContent>
      </Card>

      {readOnly && (
        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s test</CardTitle>
            <CardDescription>What the person sees during the test (read only).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {testsOpen ? (
              p.tests.map((t: any) => (
                <div key={t.id} className="space-y-2">
                  {t.kind === 'surprise' && <div className="rounded-md bg-violet-100 p-2 text-sm font-semibold text-violet-900 dark:bg-violet-900/40 dark:text-violet-200">Surprise test! Questions from this week&apos;s lessons and earlier misses.</div>}
                  <TestPreview test={t} />
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No open test right now.</div>
            )}
          </CardContent>
        </Card>
      )}

      {readOnly && <Remarks email={p.email} remarks={p.remarks || []} onSaved={onDone} />}

      {readOnly && p.results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              <Sparkline series={[...p.results].reverse().map((r: any) => r.percent)} />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1">Day</th>
                  <th>Test</th>
                  <th>Level</th>
                  <th>Score</th>
                  {readOnly && <th>Time</th>}
                  {readOnly && <th>Flag</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {p.results.map((r: any) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1.5">{fmtDay(r.day)}</td>
                    <td>{r.kind === 'surprise' ? 'Surprise' : 'Daily'}</td>
                    <td>{r.level}</td>
                    <td>{r.status === 'missed' ? 'Not taken' : `${r.score}/${r.total} (${r.percent}%)`}</td>
                    {readOnly && <td className="text-muted-foreground">{r.status === 'done' ? fmtDur(r.tookMs) ?? '—' : '—'}</td>}
                    {readOnly && <td>{flagged(r.signals) ? <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">check</span> : ''}</td>}
                    <td className="text-right">
                      {r.status === 'done' && (
                        <Button variant="ghost" size="sm" onClick={() => openReview(r.id)}>
                          See answers
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {p.pastLessons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Earlier lessons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {p.pastLessons.map((l: any) => (
              <Lesson key={l.id} l={l} />
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

// A small line of scores over time (oldest left), 0 to 100.
function Sparkline({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const w = 160;
  const h = 32;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * w},${h - (Math.max(0, Math.min(100, v)) / 100) * h}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`Scores: ${series.join(', ')}%`} className="inline-block align-middle">
      <polyline points={pts} fill="none" className="stroke-primary" strokeWidth="2" />
    </svg>
  );
}

// Know UIC: the services catalogue the lessons use (built from our website, refreshed weekly).
function KnowUic({ cat, canManage, onRefresh }: { cat: any; canManage: boolean; onRefresh: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Know UIC</CardTitle>
        <CardDescription>
          Our services as the Know UIC lessons teach them, built only from our website (service pages in Website Content, the service links in Settings, our blog posts). Read only; refreshed every week.
          {cat?.builtAt && ` Last built ${new Date(cat.builtAt).toLocaleDateString('en-IN')}.`}
        </CardDescription>
        {canManage && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={onRefresh}><RefreshCw className="size-4" />Rebuild now</Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!cat?.services?.length ? (
          <p className="text-muted-foreground">No service page found yet. Add the service pages in Website Content (/services/...) or the service links in Settings; until then each Know UIC lesson reads a service page on usaindiacfo.com itself, or is skipped.</p>
        ) : (
          cat.services.map((s: any) => (
            <details key={s.url + s.name} className="rounded-md border p-2">
              <summary className="cursor-pointer font-medium">{s.name}</summary>
              <p className="mt-1">{s.summary}</p>
              <a href={safeHref(s.url)} target="_blank" rel="noreferrer" className="text-xs underline">{s.url}</a>
              {s.posts?.length > 0 && <div className="text-xs text-muted-foreground">Our posts: {s.posts.join(' | ')}</div>}
            </details>
          ))
        )}
        {cat?.process?.length > 0 && <div className="text-xs text-muted-foreground">How we work: {cat.process.map((p: any) => p.title).join(', ')}</div>}
      </CardContent>
    </Card>
  );
}

// Every lesson's walkthrough and videos, by track and topic.
function Library({ items }: { items: any[] }) {
  const [track, setTrack] = useState('all');
  const [open, setOpen] = useState<number | null>(null);
  const shown = items.filter((x) => track === 'all' || x.track === track);
  const topics = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const x of shown) m.set(`${x.trackLabel}: ${x.topic}`, [...(m.get(`${x.trackLabel}: ${x.topic}`) || []), x]);
    return [...m.entries()];
  }, [shown]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Video className="size-5" />Videos</CardTitle>
        <CardDescription>Every lesson&apos;s slide walkthrough and its videos, by track and topic.</CardDescription>
        <CardAction>
          <select className="rounded-md border bg-background px-2 py-1 text-sm" value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Track">
            <option value="all">All tracks</option>
            <option value="technical">Technical knowledge</option>
            <option value="uic">Know UIC</option>
            <option value="marketing">Marketing skills</option>
          </select>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!topics.length && <p className="text-muted-foreground">Nothing yet.</p>}
        {topics.map(([topic, list]) => (
          <div key={topic} className="rounded-md border p-2">
            <div className="font-medium">{topic}</div>
            <ul className="mt-1 space-y-1">
              {list.map((x) => (
                <li key={x.id}>
                  <button className="text-left underline" onClick={() => setOpen(open === x.id ? null : x.id)}>
                    {fmtDay(x.day)} · level {x.level}{x.audience === 'manager' ? ' (manager)' : ''}: {x.title} {x.videos.length ? `(${x.videos.length} video${x.videos.length > 1 ? 's' : ''})` : ''}
                  </button>
                  {open === x.id && (
                    <div className="mt-2 space-y-3">
                      <SlidePlayer slides={x.slides} />
                      <Videos videos={x.videos} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type SortKey = 'name' | 'level' | 'average' | 'trend' | 'points' | 'streak' | 'tests';
// The admin's and managers' report: sortable, with the trend line, CSV download.
function TeamReport({ data, person, setPerson, admin, openReview }: { data: any; person: string; setPerson: (e: string) => void; admin: (a: string, x?: any) => void; openReview: (id: number) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const rows = [...data.report].sort((a: any, b: any) => {
    const v = (r: any) => (sort.key === 'name' ? (r.name || r.email).toLowerCase() : r[sort.key] ?? -1e9);
    return v(a) < v(b) ? -sort.dir : v(a) > v(b) ? sort.dir : 0;
  });
  const th = (key: SortKey, label: string) => (
    <th className="cursor-pointer select-none py-1 pr-2" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 }))}>
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><GraduationCap className="size-5" /> Team training report</CardTitle>
        <CardDescription>
          Everyone but the admin takes the training (managers at manager level). Click a heading to sort, a name to open their page. Levels move with recent scores: {data.thresholds.up}% average over the last {data.thresholds.window} tests moves up, under {data.thresholds.down}% moves down.
          {data.lastRun?.at && ` Last daily run: ${new Date(data.lastRun.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST${data.lastRun.errors?.length ? `, ${data.lastRun.errors.length} error(s): ${data.lastRun.errors.join('; ')}` : ''}.`}
        </CardDescription>
        <CardAction className="flex gap-2">
          <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href="/api/associate-training?report=csv" download>
            <Download className="size-4" /> CSV
          </a>
          {data.canManage && (
            <Button variant="outline" size="sm" onClick={() => admin('run')}>
              <RefreshCw className="size-4" /> Prepare today now
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nobody is in the training yet. Everyone on the Team list except the admin joins at the next daily run.</div>
        ) : (
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                {th('name', 'Person')}
                {th('level', 'Level')}
                {th('tests', 'Tests')}
                {th('average', 'Average (last 5)')}
                {th('trend', 'Trend')}
                <th className="pr-2">Over time</th>
                <th className="pr-2">Technical / Know UIC / Marketing</th>
                {th('streak', 'Test streak')}
                {th('points', 'Game points')}
                <th className="pr-2">Surprise</th>
                <th>In training</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.email} className={`border-t align-top ${person === r.email ? 'bg-muted' : ''}`}>
                  <td className="py-1.5 pr-2">
                    <button className="text-left underline" onClick={() => setPerson(person === r.email ? '' : r.email)}>{r.name || r.email}</button>
                    <div className="text-xs text-muted-foreground">{r.role}</div>
                    {r.strengths.length > 0 && <div className="text-xs text-emerald-700 dark:text-emerald-400">Strong: {r.strengths.join(', ')}</div>}
                    {r.weak.length > 0 && <div className="text-xs text-red-600">Weak: {r.weak.join(', ')}</div>}
                  </td>
                  <td className="pr-2">
                    {data.canManage ? (
                      <select className="rounded border bg-background px-1" value={r.level} onChange={(e) => admin('level', { email: r.email, level: Number(e.target.value) })}>
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    ) : (
                      r.level
                    )}
                    {r.levels.length > 0 && <div className="text-xs text-muted-foreground">{r.levels.slice(-3).map((l: any) => `${l.from}→${l.to}`).join(', ')}</div>}
                  </td>
                  <td className="pr-2">{r.tests}</td>
                  <td className="pr-2">
                    {r.average === null ? '-' : `${r.average}%`}
                    {r.last && r.last.status === 'done' && (
                      <button className="block text-xs underline" onClick={() => openReview(r.last.id)}>last: {r.last.percent}%</button>
                    )}
                  </td>
                  <td className={`pr-2 ${r.trend > 0 ? 'text-emerald-600' : r.trend < 0 ? 'text-red-600' : ''}`}>{r.trend === null ? '-' : `${r.trend > 0 ? '+' : ''}${r.trend}`}</td>
                  <td className="pr-2"><Sparkline series={r.series.map((s: any) => s.percent)} /></td>
                  <td className="pr-2">{['technical', 'uic', 'marketing'].map((t) => (r.tracks[t] === null ? '-' : `${r.tracks[t]}%`)).join(' / ')}</td>
                  <td className="pr-2">{r.streak}</td>
                  <td className="pr-2">{r.points}{r.badge ? <div className="text-xs text-amber-700 dark:text-amber-300">{r.badge}</div> : null}</td>
                  <td className="pr-2 text-xs">{r.surprise.length ? r.surprise.slice(0, 4).map((s: any) => `${s.day.slice(5)}: ${s.status === 'missed' ? 'missed' : `${s.percent}%`}`).join(', ') : '-'}</td>
                  <td>{data.canManage ? <input type="checkbox" checked={r.active} onChange={(e) => admin('active', { email: r.email, active: e.target.checked })} aria-label="In training" /> : r.active ? 'Yes' : 'Paused'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export default function AssociateTrainingTab() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [review, setReview] = useState<any>(null);
  const [person, setPerson] = useState<string>('');
  const [view, setView] = useState<'mine' | 'team' | 'uic' | 'videos'>('mine');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/associate-training${person ? `?person=${encodeURIComponent(person)}` : ''}`);
      const j = await res.json().catch(() => ({ error: `The server did not answer properly (HTTP ${res.status}).` }));
      if (!res.ok) throw new Error(j.error);
      setData(j);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }, [person]);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(() => onScreen('tab-associates') && load(), 60000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  async function openReview(id: number) {
    const res = await fetch(`/api/associate-training?test=${id}`);
    const j = await res.json().catch(() => ({}));
    if (res.ok) setReview(j.test);
  }
  async function admin(action: string, extra: any = {}) {
    try {
      await post({ action, ...extra });
    } catch (e: any) {
      alert(e.message);
    }
    await load();
  }

  if (err) return <div className="text-sm text-red-600">{err}</div>;
  if (!data) return <Loader2 className="size-5 animate-spin" />;

  const reviewCard = review && (
    <Card>
      <CardHeader>
        <CardTitle>
          Answers for {fmtDay(review.day)} ({review.percent}%){data.viewer ? `: ${review.email}` : ''}
        </CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => setReview(null)}>
            Close
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Review test={review} meta={data.viewer} />
      </CardContent>
    </Card>
  );
  const views: { key: typeof view; label: string }[] = [
    ...(data.trainee ? [{ key: 'mine' as const, label: 'My training' }] : []),
    ...(data.viewer ? [{ key: 'team' as const, label: 'Team report' }] : []),
    { key: 'uic', label: 'Know UIC' },
  ];
  const current = views.some((v) => v.key === view) ? view : views[0].key;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {views.map((v) => (
          <Button key={v.key} size="sm" variant={current === v.key ? 'default' : 'outline'} onClick={() => setView(v.key)}>
            {v.label}
          </Button>
        ))}
      </div>
      {current === 'mine' && data.me && <PersonPage p={data.me} data={data} readOnly={false} onDone={load} openReview={openReview} />}
      {current === 'team' && (
        <>
          <LiveTests />
          <TeamReport data={data} person={person} setPerson={setPerson} admin={admin} openReview={openReview} />
          {data.person && <PersonPage p={data.person} data={data} readOnly onDone={load} openReview={openReview} />}
          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s lessons</CardTitle>
              <CardDescription>One lesson per track, level and audience, shared by everyone there.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.todayLessons.length ? data.todayLessons.map((l: any) => <Lesson key={l.id} l={l} />) : <div className="text-sm text-muted-foreground">No lessons yet today. They are made at 09:00 IST.</div>}
            </CardContent>
          </Card>
        </>
      )}
      {current === 'uic' && <KnowUic cat={data.catalogue} canManage={data.canManage} onRefresh={() => admin('catalogue')} />}
      {reviewCard}
    </div>
  );
}
