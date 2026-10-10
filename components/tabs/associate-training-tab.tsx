'use client';

// Associate Training: today's short lesson to read, today's test on yesterday's lesson (plus the
// questions answered wrong two days ago), results, and the level. The admin also sees everyone.
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, GraduationCap, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRole } from '@/hooks/use-role';

const fmtDay = (d?: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }) : '');

function Lesson({ l, open: startOpen }: { l: any; open?: boolean }) {
  const [open, setOpen] = useState(Boolean(startOpen));
  return (
    <div className="rounded-lg border">
      <button className="flex w-full items-center justify-between gap-2 p-3 text-left" onClick={() => setOpen(!open)}>
        <span className="font-medium">
          {l.title} <span className="text-xs font-normal text-muted-foreground">{fmtDay(l.day)} · level {l.level}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t p-3">
          <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: l.content_html }} />
          {l.sources?.length > 0 && (
            <div className="mt-3 text-xs text-muted-foreground">
              Sources:{' '}
              {l.sources.map((s: any, i: number) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" className="mr-2 underline">
                  {s.title}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Review({ test }: { test: any }) {
  return (
    <div className="space-y-3">
      {test.questions.map((q: any, i: number) => {
        const picked = test.answers?.[q.id];
        const right = picked !== undefined && Number(picked) === q.answer;
        return (
          <div key={q.id} className="rounded-lg border p-3 text-sm">
            <div className="flex gap-2 font-medium">
              {right ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <XCircle className="size-4 shrink-0 text-red-600" />}
              {i + 1}. {q.q}
            </div>
            <div className="mt-1 pl-6">
              {!right && <div className="text-red-600">Your answer: {picked !== undefined ? q.options[picked] : 'not answered'}</div>}
              <div className="text-emerald-700 dark:text-emerald-400">Right answer: {q.options[q.answer]}</div>
              {q.explain && <div className="text-muted-foreground">{q.explain}</div>}
              {!right && <div className="text-xs text-muted-foreground">This question will be asked again in two days.</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Test({ test, onDone }: { test: any; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  async function submit() {
    if (Object.keys(answers).length < test.questions.length && !confirm('Some questions are not answered. Submit anyway?')) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/associate-training', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', testId: test.id, answers }) });
      const j = await res.json().catch(() => ({ error: `The server did not answer properly (HTTP ${res.status}).` }));
      if (!res.ok) throw new Error(j.error);
      setResult(j);
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
          Score: {result.score} / {result.total} ({result.percent}%){result.levelUp && ' · Well done, you moved up a level. Tomorrow’s lesson is a step harder.'}
        </div>
        <Review test={result} />
        <Button onClick={onDone}>Close</Button>
      </div>
    );
  return (
    <div className="space-y-4">
      {test.questions.map((q: any, i: number) => (
        <div key={q.id} className="space-y-2 rounded-lg border p-3">
          <div className="text-sm font-medium">
            {i + 1}. {q.q} {q.repeat && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Asked again</span>}
          </div>
          {q.options.map((o: string, k: number) => (
            <label key={k} className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name={q.id} className="mt-1" checked={answers[q.id] === k} onChange={() => setAnswers({ ...answers, [q.id]: k })} />
              {o}
            </label>
          ))}
        </div>
      ))}
      {err && <div className="text-sm text-red-600">{err}</div>}
      <Button onClick={submit} disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />} Submit the test
      </Button>
    </div>
  );
}

export default function AssociateTrainingTab() {
  const { role } = useRole();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [review, setReview] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/associate-training');
      const j = await res.json().catch(() => ({ error: `The server did not answer properly (HTTP ${res.status}).` }));
      if (!res.ok) throw new Error(j.error);
      setData(j);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 60000);
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
    setBusy(action + (extra.email || ''));
    try {
      const res = await fetch('/api/associate-training', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) alert(j.error || 'Failed');
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (err) return <div className="text-sm text-red-600">{err}</div>;
  if (!data) return <Loader2 className="size-5 animate-spin" />;
  const lvl = data.levels[data.profile.level];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="size-5" /> Associate Training
          </CardTitle>
          <CardDescription>
            Every morning at 09:00 IST you get a short lesson to read: our company, our services and the latest news, rules and laws. The next morning there is a test on it. Questions you get wrong come back two days later. Two tests in a row at {data.passPercent}% or more move you up a level.
          </CardDescription>
          <CardAction>
            <div className="text-right text-sm">
              <div className="font-semibold">Level {data.profile.level} of 5</div>
              <div className="text-xs text-muted-foreground">
                {lvl?.words} words, {lvl?.questions} questions a day
              </div>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {data.profile.streak > 0 ? `${data.profile.streak} test at ${data.passPercent}% or more. One more to move up.` : `Score ${data.passPercent}% or more in two tests in a row to move up.`}
          {data.dueAgain > 0 && ` ${data.dueAgain} question(s) waiting to be asked again.`}
          {!data.profile.active && ' Your training is paused by the admin.'}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s test</CardTitle>
          <CardDescription>On yesterday&apos;s lesson, plus questions answered wrong earlier.</CardDescription>
        </CardHeader>
        <CardContent>{data.test ? <Test key={data.test.id} test={data.test} onDone={load} /> : <div className="text-sm text-muted-foreground">No test waiting. Your first test comes the morning after your first lesson.</div>}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s lesson</CardTitle>
          <CardDescription>Read it today. Tomorrow&apos;s test asks about it.</CardDescription>
        </CardHeader>
        <CardContent>{data.lesson ? <Lesson l={data.lesson} open /> : <div className="text-sm text-muted-foreground">Your lesson is being prepared. This takes a few minutes; the page refreshes by itself.</div>}</CardContent>
      </Card>

      {data.results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My results</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1">Day</th>
                  <th>Level</th>
                  <th>Score</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.results.map((r: any) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1.5">{fmtDay(r.day)}</td>
                    <td>{r.level}</td>
                    <td>{r.status === 'missed' ? 'Not taken' : `${r.score}/${r.total} (${r.percent}%)`}</td>
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

      {review && (
        <Card>
          <CardHeader>
            <CardTitle>
              Answers for {fmtDay(review.day)} ({review.percent}%){role === 'admin' && review.email ? `: ${review.email}` : ''}
            </CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => setReview(null)}>
                Close
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Review test={review} />
          </CardContent>
        </Card>
      )}

      {data.pastLessons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Earlier lessons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.pastLessons.map((l: any) => (
              <Lesson key={l.id} l={l} />
            ))}
          </CardContent>
        </Card>
      )}

      {role === 'admin' && data.everyone && (
        <Card>
          <CardHeader>
            <CardTitle>Everyone (admin only)</CardTitle>
            <CardDescription>
              People join when they first open this page. {data.lastRun?.at && `Last daily run: ${new Date(data.lastRun.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST${data.lastRun.errors?.length ? `, ${data.lastRun.errors.length} error(s): ${data.lastRun.errors.join('; ')}` : ''}.`}
            </CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" disabled={busy === 'run'} onClick={() => admin('run')}>
                {busy === 'run' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Prepare today now
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1">Person</th>
                  <th>Level</th>
                  <th>Tests</th>
                  <th>Average (last 5)</th>
                  <th>Last test</th>
                  <th>Asked again</th>
                  <th>In training</th>
                </tr>
              </thead>
              <tbody>
                {data.everyone.map((p: any) => (
                  <tr key={p.email} className="border-t">
                    <td className="py-1.5">{p.name || p.email}</td>
                    <td>
                      <select className="rounded border bg-background px-1" value={p.level} onChange={(e) => admin('level', { email: p.email, level: Number(e.target.value) })}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{p.tests}</td>
                    <td>{p.average === null ? '-' : `${p.average}%`}</td>
                    <td>
                      {p.last ? (
                        p.last.status === 'missed' ? (
                          `${fmtDay(p.last.day)}: not taken`
                        ) : (
                          <button className="underline" onClick={() => openReview(p.last.id)}>
                            {fmtDay(p.last.day)}: {p.last.percent}%
                          </button>
                        )
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{p.dueAgain}</td>
                    <td>
                      <input type="checkbox" checked={p.active} onChange={(e) => admin('active', { email: p.email, active: e.target.checked })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
