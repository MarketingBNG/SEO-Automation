'use client';

// The SEB (Safe Exam Browser) training-only page. First screen is Check In (enter the short-lived code
// from the regular browser). After check-in it shows today's assigned lesson or test; Finish asks the
// server to save completion and only navigates to the configured quit URL once the server confirms.
// Google OAuth is never done here. No secret is in the URL.
import { useCallback, useEffect, useState } from 'react';

type Today = { status: string; locked: boolean; name: string | null; item: any; attendance: any; error?: string };

export default function SebPage() {
  const [today, setToday] = useState<Today | null>(null);
  const [needCheckIn, setNeedCheckIn] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [written, setWritten] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setMsg(null);
    const r = await fetch('/api/seb/today');
    if (r.status === 401) { setNeedCheckIn(true); setToday(null); return; }
    const j = await r.json();
    setNeedCheckIn(false);
    setToday(j);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function checkIn() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/seb/check-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim() }) });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error || 'Check in failed.'); return; }
      await load();
    } finally { setBusy(false); }
  }

  async function finish() {
    if (!today?.item) return;
    setBusy(true); setMsg(null);
    try {
      const body = today.item.kind === 'lesson'
        ? { kind: 'lesson', lessonId: today.item.id }
        : { kind: 'test', testId: today.item.id, answers, written };
      const r = await fetch('/api/seb/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error || 'Could not save. Try again.'); return; }
      if (j.done && j.quitUrl) { window.location.href = j.quitUrl; return; }
      if (j.done) { setMsg('Completed. (No quit URL is configured.)'); await load(); return; }
      setMsg('Saved, but today is not complete yet.');
      await load();
    } finally { setBusy(false); }
  }

  const wrap = 'min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4';
  const card = 'w-full max-w-2xl rounded-2xl bg-slate-800 p-6 shadow-xl';

  if (needCheckIn) {
    return (
      <div className={wrap}><div className={card}>
        <h1 className="text-xl font-semibold">Check In</h1>
        <p className="mt-1 text-sm text-slate-300">Open your regular browser, go to the SEB code page, and enter the code shown there.</p>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter check-in code" className="mt-4 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2" />
        {msg && <div className="mt-2 text-sm text-red-400">{msg}</div>}
        <button disabled={busy || !code.trim()} onClick={checkIn} className="mt-4 w-full rounded-lg bg-indigo-500 px-4 py-2 font-medium disabled:opacity-50">{busy ? 'Checking in…' : 'Check In'}</button>
      </div></div>
    );
  }

  if (!today) return <div className={wrap}><div className={card}>Loading…</div></div>;

  const att = today.attendance?.status;
  const attLine = att && att !== 'none' ? <div className="mb-3 text-xs text-slate-400">Attendance: {att}{today.attendance?.reason ? ` — ${today.attendance.reason}` : ''}</div> : null;

  const info = (t: string) => <div className={wrap}><div className={card}>{attLine}<h1 className="text-xl font-semibold">{t}</h1></div></div>;
  if (today.status === 'before-window') return info('Training opens at 9:00 AM IST.');
  if (today.status === 'done') return info('Today’s training is complete. You may quit.');
  if (today.status === 'not-ready') return info('Today’s training is being prepared. Please wait a moment and refresh.');
  if (today.status === 'no-training') return info('No training scheduled today.');
  if (today.status === 'error') return info('Could not load training. Please try again shortly.');

  const item = today.item;
  if (!item) return info('Nothing to do right now.');

  return (
    <div className={wrap}><div className={card}>
      {attLine}
      {item.kind === 'lesson' ? (
        <>
          <h1 className="text-xl font-semibold">{item.title}</h1>
          <div className="prose prose-invert mt-3 max-h-[60vh] overflow-auto text-sm" dangerouslySetInnerHTML={{ __html: item.content_html || '' }} />
          <button disabled={busy} onClick={finish} className="mt-5 w-full rounded-lg bg-emerald-500 px-4 py-2 font-medium disabled:opacity-50">{busy ? 'Saving…' : 'I have read today’s lesson'}</button>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Today’s test</h1>
          <div className="mt-3 max-h-[60vh] space-y-4 overflow-auto">
            {(item.questions || []).map((q: any, i: number) => (
              <div key={q.id} className="rounded-lg border border-slate-700 p-3">
                <div className="text-sm font-medium">{i + 1}. {q.q}</div>
                {q.kind === 'written' ? (
                  <textarea value={written[q.id] || ''} onChange={(e) => setWritten((w) => ({ ...w, [q.id]: e.target.value }))} className="mt-2 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm" rows={3} />
                ) : (
                  <div className="mt-2 space-y-1">
                    {(q.options || []).map((o: string, oi: number) => (
                      <label key={oi} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))} />
                        {o}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button disabled={busy} onClick={finish} className="mt-5 w-full rounded-lg bg-emerald-500 px-4 py-2 font-medium disabled:opacity-50">{busy ? 'Submitting…' : 'Finish test'}</button>
        </>
      )}
      {msg && <div className="mt-2 text-sm text-amber-400">{msg}</div>}
    </div></div>
  );
}
