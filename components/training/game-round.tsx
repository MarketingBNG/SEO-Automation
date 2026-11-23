'use client';

// The lesson game round, shared by the dashboard training tab and the SEB training page so both show the
// same games, UI and (server-side) scoring. The caller passes onSubmit, which posts the answers to its
// own endpoint and returns the scored result; this component only renders and collects answers. Scoring
// stays authoritative on the server (lib/associateTraining.playGame).
import { useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type GameData = {
  match: { terms: string[]; definitions: string[]; answer: number[] } | null;
  order: { title: string; shuffled: string[]; answer: number[] } | null;
  cases: { scenario: string; options: string[]; answer: number; explain: string }[];
  blanks: { sentence: string; options: string[]; answer: number }[];
  lightning: { statement: string; answer: boolean }[];
};

export function GameRound({ games, idKey, onSubmit, onPlayed }: { games: GameData; idKey: number | string; onSubmit: (answers: any) => Promise<any>; onPlayed?: (r: any) => void }) {
  const g = games;
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
      const r = await onSubmit({ match, order, cases, blanks, lightning, seconds });
      setResult(r);
      onPlayed?.(r);
    } catch (e: any) {
      setErr(e?.message || 'Could not submit the game.');
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
                {g.match!.definitions.map((d: string, k: number) => (
                  <option key={k} value={k}>{d}</option>
                ))}
              </select>
              {result && <span className={g.match!.answer[i] === match[i] ? 'text-emerald-600' : 'text-red-600'}>{g.match!.answer[i] === match[i] ? 'Right' : `Right answer: ${g.match!.definitions[g.match!.answer[i]]}`}</span>}
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
                <span className="flex-1">{g.order!.shuffled[k]}</span>
                <Button size="icon" variant="ghost" aria-label="Move up" disabled={pos === 0} onClick={() => move(pos, -1)}><ArrowUp className="size-4" /></Button>
                <Button size="icon" variant="ghost" aria-label="Move down" disabled={pos === order.length - 1} onClick={() => move(pos, 1)}><ArrowDown className="size-4" /></Button>
              </li>
            ))}
          </ol>
          {result && <div className="text-xs">Right order: {g.order!.answer.map((k: number) => g.order!.shuffled[k]).join(' → ')}</div>}
        </div>
      )}
      {g.cases.map((c: any, i: number) => (
        <div key={i} className="space-y-1 rounded-lg border p-3">
          <div className="font-semibold">Client case {i + 1}</div>
          <div>{c.scenario}</div>
          {c.options.map((o: string, k: number) => (
            <label key={k} className="flex items-start gap-2">
              <input type="radio" className="mt-1" name={`case-${idKey}-${i}`} checked={cases[i] === k} onChange={() => pick(cases, setCases, i, k)} />
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
