'use client';

// The SEB (Safe Exam Browser) training-only page. First screen is Check In (enter the short-lived code
// from the regular browser). After check-in it shows today's assigned lesson or test; Finish asks the
// server to save completion and only navigates to the configured quit URL once the server confirms.
// Google OAuth is never done here. No secret is in the URL.
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { SEB_BUILD_TAG } from '@/lib/sebBuild';

// The game UI is loaded only when a lesson is shown. Isolating it in its own chunk (ssr:false) means a
// problem loading/evaluating the game can never block the whole /seb page from hydrating and running its
// startup logic (which is what showed an endless "Loading…").
const GameRound = dynamic(() => import('@/components/training/game-round').then((m) => m.GameRound), { ssr: false });

// Rendered into the server HTML, so it shows ON THE DEVICE even if the client never hydrates: if SEB
// shows this exact tag, the running build includes this code; an older tag or none means Coolify is still
// serving an older build. Shared with /api/seb/version via lib/sebBuild.
const BUILD_TAG = SEB_BUILD_TAG;

type Today = { status: string; locked: boolean; name: string | null; item: any; attendance: any; quitUrl?: string; error?: string };

// Bounded requests: SEB is a kiosk, so a stalled request must never leave the screen on "Loading…"
// forever. Every call aborts after its timeout and surfaces a clear error with Retry.
const TODAY_TIMEOUT_MS = 12000;
const CHECKIN_TIMEOUT_MS = 12000;
const ACTION_TIMEOUT_MS = 20000;
// Submitting a test can take longer: written answers are graded by the AI on the server.
const SUBMIT_TIMEOUT_MS = 120000;
// Backstop: if nothing has resolved this long after mount (no lesson, no Check In screen, no error), show
// the error/Retry screen anyway, so the page can never sit on "Loading…" forever while JS is running.
const WATCHDOG_MS = 18000;

async function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

export default function SebPage() {
  const [today, setToday] = useState<Today | null>(null);
  const [needCheckIn, setNeedCheckIn] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [written, setWritten] = useState<Record<string, string>>({});

  // Load today's assignment. On a 401 (no session) show Check In; on an HTTP error, a non-JSON body, a
  // timeout, or a network failure show a clear error with Retry instead of an endless "Loading…".
  const load = useCallback(async () => {
    setMsg(null); setLoadError(null);
    try {
      const r = await fetchWithTimeout('/api/seb/today', {}, TODAY_TIMEOUT_MS);
      if (r.status === 401) { setNeedCheckIn(true); setToday(null); return; }
      if (!r.ok) { setLoadError(`Could not load training (HTTP ${r.status}). Please retry.`); return; }
      const j = await r.json();
      setNeedCheckIn(false);
      setToday(j);
    } catch (e: any) {
      setLoadError(e?.name === 'AbortError' ? 'Loading timed out. Please retry.' : 'Could not reach the server. Please retry.');
    }
  }, []);

  // On launch the Windows launcher opens /seb#code=<fresh single-use code> (from the enrollment
  // exchange). Redeem it silently for the SEB session, scrub it from the address bar, then load. If
  // redemption is slow or fails, the session may still have been created server-side, so we do NOT show
  // an error here: load() then detects the session (200) or asks for a code (401). Normal repeat
  // enrollment stays silent. If no code and no session, the manual Check In screen is shown.
  useEffect(() => {
    (async () => {
      try {
        const h = typeof window !== 'undefined' ? window.location.hash : '';
        const m = h ? /[#&]code=([^&]+)/.exec(h) : null;
        if (m) {
          const c = decodeURIComponent(m[1]);
          try { history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
          try {
            await fetchWithTimeout('/api/seb/check-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c }) }, CHECKIN_TIMEOUT_MS);
          } catch { /* redemption slow/failed: session may already exist; load() decides. */ }
        }
      } finally {
        await load();
      }
    })();
  }, [load]);

  // Watchdog: if startup never reaches a lesson, the Check In screen, or an error within WATCHDOG_MS,
  // force the error/Retry screen. This covers any path where the startup chain neither resolves nor
  // rejects, so "Loading…" is never permanent as long as the page's JS is running.
  useEffect(() => {
    const t = setTimeout(() => {
      setLoadError((prev) => prev ?? 'Startup is taking too long. Please retry.');
    }, WATCHDOG_MS);
    return () => clearTimeout(t);
  }, []);

  // On a no-training day (e.g. Sunday), or once today's training is already done (e.g. the Finish reply
  // was lost to a timeout but the server saved it), quit SEB to the desktop. Read-only: nothing is
  // marked complete here and no timesheet sync is triggered.
  useEffect(() => {
    if (today && (today.status === 'no-training' || today.status === 'done') && today.quitUrl) {
      window.location.href = today.quitUrl;
    }
  }, [today]);

  async function punch() {
    setBusy(true); setMsg(null);
    try {
      const j = await fetchWithTimeout('/api/seb/punch', { method: 'POST' }, ACTION_TIMEOUT_MS).then((r) => r.json()).catch(() => ({}));
      const a = j?.attendance;
      // Surface the outcome so a check-in that cannot complete says WHY (the button no longer looks dead).
      if (a?.status === 'confirmed') setMsg('Checked in.');
      else if (a?.status === 'in_progress' || a?.status === 'pending') setMsg('Check in is being recorded. Tap again in a moment to confirm.');
      else if (a?.status === 'not-connected') setMsg(a.reason || 'Connect Zoho People once from your regular browser, then check in.');
      else if (a?.reason) setMsg(`Could not check in: ${a.reason}`);
      else if (a?.status && a.status !== 'none') setMsg(`Check in: ${a.status}`);
      else setMsg('Could not check in. Try again.');
      await load();
    } catch (e: any) {
      setMsg(e?.name === 'AbortError' ? 'Check in timed out. Try again.' : 'Could not reach the server. Try again.');
    } finally { setBusy(false); }
  }

  // Submit a lesson game through the SEB session. Returns the scored result for the shared GameRound to
  // show. It does not complete the lesson or close SEB; the Finished button does that.
  async function playGame(answers: any) {
    if (!today?.item) throw new Error('No lesson.');
    const r = await fetchWithTimeout('/api/seb/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lessonId: today.item.id, answers }) }, ACTION_TIMEOUT_MS);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Could not submit the game (HTTP ${r.status}).`);
    return j;
  }

  async function finish() {
    if (!today?.item) return;
    setBusy(true); setMsg(null);
    try {
      const body = today.item.kind === 'lesson'
        ? { kind: 'lesson', lessonId: today.item.id }
        // The server grades written answers from { text } (same shape the dashboard sends).
        : { kind: 'test', testId: today.item.id, answers, written: Object.fromEntries(Object.entries(written).map(([id, text]) => [id, { text }])) };
      const r = await fetchWithTimeout('/api/seb/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, today.item.kind === 'test' ? SUBMIT_TIMEOUT_MS : ACTION_TIMEOUT_MS);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error || `Could not save (HTTP ${r.status}). Try again.`); return; }
      if (j.done && j.quitUrl) { window.location.href = j.quitUrl; return; }
      if (j.done) { setMsg('Completed. (No quit URL is configured.)'); await load(); return; }
      setMsg('Saved, but today is not complete yet.');
      await load();
    } catch (e: any) {
      // The completion is only saved when the server confirms; a timeout here does not quit SEB.
      // A timeout may still have saved on the server: reload, and a day that is now done quits SEB.
      setMsg(e?.name === 'AbortError' ? 'Saving is taking long. Checking whether it was saved…' : 'Could not reach the server. Try again.');
      if (e?.name === 'AbortError') await load();
    } finally { setBusy(false); }
  }

  const wrap = 'min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4';
  const card = 'w-full max-w-2xl rounded-2xl bg-slate-800 p-6 shadow-xl';

  if (needCheckIn) {
    // No code is asked for. The launcher verifies the device by its work token and opens SEB with a
    // session. If there is no session here, the device is not set up (or the token is wrong).
    return (
      <div className={wrap}><div className={card}>
        <h1 className="text-xl font-semibold">Device not set up</h1>
        <p className="mt-1 text-sm text-slate-300">This device is not linked for training yet. Ask your admin to run the SEB setup with this device’s token. You do not need to enter a code.</p>
        <button disabled={busy} onClick={() => { setBusy(true); load().finally(() => setBusy(false)); }} className="mt-4 w-full rounded-lg bg-indigo-500 px-4 py-2 font-medium disabled:opacity-50">{busy ? 'Checking…' : 'Try again'}</button>
        <div className="mt-3 text-[10px] text-slate-500">build {BUILD_TAG}</div>
      </div></div>
    );
  }

  if (loadError && !today) {
    return (
      <div className={wrap}><div className={card}>
        <h1 className="text-xl font-semibold">Could not load</h1>
        <p className="mt-1 text-sm text-red-400">{loadError}</p>
        <button disabled={busy} onClick={() => { setBusy(true); load().finally(() => setBusy(false)); }} className="mt-4 w-full rounded-lg bg-indigo-500 px-4 py-2 font-medium disabled:opacity-50">{busy ? 'Retrying…' : 'Retry'}</button>
        <p className="mt-2 text-xs text-slate-400">Still stuck? <a href="/seb" className="underline">Reload the page</a>.</p>
        <div className="mt-3 text-[10px] text-slate-500">build {BUILD_TAG}</div>
      </div></div>
    );
  }

  if (!today) {
    return (
      <div className={wrap}><div className={card}>
        <div>Loading…</div>
        <p className="mt-2 text-xs text-slate-400">If this does not move, <a href="/seb" className="underline">tap here to reload</a>.</p>
        <noscript><p className="mt-2 text-xs text-amber-400">JavaScript must be enabled in the SEB configuration for training to load.</p></noscript>
        <div className="mt-3 text-[10px] text-slate-500">build {BUILD_TAG}</div>
      </div></div>
    );
  }

  const att = today.attendance?.status;
  const attLine = (
    <div className="mb-3 flex items-center justify-between gap-2 text-xs text-slate-400">
      <span>Attendance: {att && att !== 'none' ? att : 'not checked in'}{today.attendance?.reason ? ` — ${today.attendance.reason}` : ''}</span>
      {att !== 'confirmed' && <button disabled={busy} onClick={punch} className="shrink-0 rounded bg-indigo-500 px-2 py-1 text-xs text-white disabled:opacity-50">{busy ? '…' : 'Check In'}</button>}
    </div>
  );

  const info = (t: string) => <div className={wrap}><div className={card}>{attLine}<h1 className="text-xl font-semibold">{t}</h1>{msg && <div className="mt-2 text-sm text-amber-400">{msg}</div>}</div></div>;
  if (today.status === 'before-window') return info('Training opens at 9:00 AM IST.');
  if (today.status === 'done') return info(today.quitUrl ? 'Today’s training is complete. Closing Safe Exam Browser…' : 'Today’s training is complete. You may quit.');
  if (today.status === 'not-ready') return info('Today’s training is being prepared. Please wait a moment and refresh.');
  if (today.status === 'no-training') return info(today.quitUrl ? 'No training today. Returning to the desktop…' : 'No training scheduled today.');
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
          {item.games && (
            <details className="mt-4 rounded-lg border border-slate-700">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-200">Play the game (optional)</summary>
              <div className="border-t border-slate-700 p-3">
                {/* Reuses the dashboard game UI and server scoring. Playing a game does not complete the
                    lesson: use the Finished button below to save and close SEB. */}
                <GameRound games={item.games} idKey={item.id} onSubmit={playGame} />
              </div>
            </details>
          )}
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
          {(() => {
            // Finish only when every question is answered (an option picked, or text typed).
            const left = (item.questions || []).filter((q: any) => (q.kind === 'written' ? !String(written[q.id] || '').trim() : answers[q.id] === undefined)).length;
            return (
              <>
                <button disabled={busy || left > 0} onClick={finish} className="mt-5 w-full rounded-lg bg-emerald-500 px-4 py-2 font-medium disabled:opacity-50">{busy ? 'Submitting… (grading can take up to a minute)' : left > 0 ? `Answer all questions to finish (${left} left)` : 'Finish test'}</button>
                {left > 0 && !busy && (
                  // Moving on without answering is allowed, but the test is recorded as incomplete and the
                  // unanswered questions show as "not attempted" to the admin.
                  <button onClick={() => { if (window.confirm(`${left} question(s) are not answered. They will be recorded as NOT ATTEMPTED and the test will show as incomplete. Submit anyway?`)) void finish(); }} className="mt-2 w-full rounded-lg border border-amber-500/60 px-4 py-2 text-sm text-amber-300">
                    Submit without answering ({left} not attempted)
                  </button>
                )}
              </>
            );
          })()}
        </>
      )}
      {msg && <div className="mt-2 text-sm text-amber-400">{msg}</div>}
    </div></div>
  );
}
