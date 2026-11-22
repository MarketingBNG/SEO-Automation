'use client';

// Regular-browser page (behind the normal Google sign-in). Shows a short-lived, single-use code to type
// into the SEB training browser. No secret is ever put in a URL; the code is shown on screen and expires
// in a few minutes.
import { useState } from 'react';

export default function SebCodePage() {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function getCode() {
    setBusy(true); setErr(null); setCode(null);
    try {
      const r = await fetch('/api/seb/handoff', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || 'Could not get a code.'); return; }
      setCode(j.code);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 480, margin: '4rem auto', padding: '0 1rem', lineHeight: 1.5 }}>
      <h1 style={{ fontSize: '1.25rem' }}>SEB check-in code</h1>
      <p style={{ color: '#555' }}>Click to get a one-time code, then type it into the SEB training browser. It expires in about 5 minutes and works once.</p>
      <button onClick={getCode} disabled={busy} style={{ padding: '0.5rem 1rem', borderRadius: 8, background: '#4f46e5', color: '#fff', border: 0 }}>{busy ? 'Getting…' : 'Get code'}</button>
      {code && (
        <div style={{ marginTop: '1.5rem', padding: '1rem', borderRadius: 12, background: '#f1f5f9', textAlign: 'center' }}>
          <div style={{ fontSize: '0.8rem', color: '#555' }}>Type this into SEB:</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '0.05em', wordBreak: 'break-all', userSelect: 'all' }}>{code}</div>
        </div>
      )}
      {err && <div style={{ marginTop: '0.75rem', color: '#b91c1c' }}>{err}</div>}
    </div>
  );
}
