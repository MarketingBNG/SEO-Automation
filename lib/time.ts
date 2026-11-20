// Timestamps are stored as TEXT in the exact format SQLite's datetime('now') produced
// ('YYYY-MM-DD HH:MM:SS', UTC), so string comparisons and UI display behave as before.

export function sqlNow(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Equivalent of SQLite datetime('now', modifier) for the modifiers this app uses, e.g. '-15 days',
// '-90 days', '+1 hours', '-30 minutes'.
export function sqlNowOffset(modifier: string): string {
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s+(second|minute|hour|day|month|year)s?\s*$/i.exec(String(modifier));
  if (!m) throw new Error(`Unsupported datetime modifier: ${modifier}`);
  const n = Number(m[1]);
  const d = new Date();
  switch (m[2].toLowerCase()) {
    case 'second': d.setUTCSeconds(d.getUTCSeconds() + n); break;
    case 'minute': d.setUTCMinutes(d.getUTCMinutes() + n); break;
    case 'hour': d.setUTCHours(d.getUTCHours() + n); break;
    case 'day': d.setUTCDate(d.getUTCDate() + n); break;
    case 'month': d.setUTCMonth(d.getUTCMonth() + n); break;
    case 'year': d.setUTCFullYear(d.getUTCFullYear() + n); break;
  }
  return sqlNow(d);
}

// Equivalent of SQLite date('now') -> 'YYYY-MM-DD'.
export function sqlToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// A stored UTC timestamp ('YYYY-MM-DD HH:MM:SS', or ISO with Z) shown in India time, for the
// dashboard (the same format as the Drafts & Review list). Empty for no value.
export function fmtIst(s?: string | null): string {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (/Z$|[+-]\d\d:?\d\d$/.test(String(s)) ? '' : 'Z'));
  if (isNaN(d.getTime())) return String(s);
  return istText(d);
}

// '19 Nov 2026, 3:30 pm IST'. One shared formatter: Date.toLocaleString with options builds a new
// one on every call (about 80 microseconds), which made lists of hundreds of rows (Drafts & Review,
// the calendar, Home) spend most of their time formatting dates under load. Same text as before;
// an invalid date gives 'Invalid Date IST' as toLocaleString did, instead of throwing.
const IST_FORMAT = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
export function istText(when: Date | number): string {
  const d = typeof when === 'number' ? new Date(when) : when;
  return (isNaN(d.getTime()) ? 'Invalid Date' : IST_FORMAT.format(d)) + ' IST';
}
