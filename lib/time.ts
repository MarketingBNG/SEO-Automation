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
