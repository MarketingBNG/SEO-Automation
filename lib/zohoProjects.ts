// Per-employee Zoho Projects connection and timesheet writing. Each person connects their own Zoho
// once (OAuth, token stored under provider "zoho_projects:<email>"). Then, once a day, their hours
// are logged to their project's "General" task. Reuses the existing Zoho OAuth app (ZOHO_CLIENT_ID,
// ZOHO_CLIENT_SECRET, ZOHO_ACCOUNTS_URL) but with Projects scopes and its own redirect URI.
//
// Setup needed on the Zoho side (one time): register ZOHO_PROJECTS_REDIRECT_URI as a redirect URL on
// the Zoho app, and set it (plus ZOHO_PROJECTS_PORTAL and the project ids) in Coolify.
//
// NOT yet tested against a live Zoho Projects portal; the first real run may need small fixes to the
// endpoint shape. Build it, connect one person, check the log, iterate on the real error.
import { readTokens, writeTokens, hasTokens } from './tokenStore';
import prismaClient from './prisma';
import { sqlNow } from './time';
import { istDay } from './topics';

const prisma: any = prismaClient;

const API = (process.env.ZOHO_PROJECTS_API_URL || 'https://projects.zoho.in').replace(/\/+$/, '');
const PORTAL = process.env.ZOHO_PROJECTS_PORTAL || '60037687374';
// Which Zoho project each team logs time to.
export const PROJECT_BY_TEAM: Record<string, string> = {
  marketing: process.env.ZOHO_PROJECT_MARKETING || '283967000001053334', // Marketing_SGS_Zoho
  automation: process.env.ZOHO_PROJECT_AUTOMATION || '283967000006362390', // Automation team timesheet project
};
const SCOPES = ['ZohoProjects.portals.READ', 'ZohoProjects.projects.READ', 'ZohoProjects.tasks.ALL', 'ZohoProjects.timesheets.ALL'].join(',');
const provider = (email: string) => `zoho_projects:${email.toLowerCase()}`;

function cfg() {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const accountsUrl = process.env.ZOHO_ACCOUNTS_URL; // e.g. https://accounts.zoho.in
  const redirectUri = process.env.ZOHO_PROJECTS_REDIRECT_URI; // e.g. https://<dashboard>/api/zoho-projects/oauth-callback
  if (!clientId || !clientSecret || !accountsUrl || !redirectUri) {
    throw new Error('ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_ACCOUNTS_URL or ZOHO_PROJECTS_REDIRECT_URI is not set.');
  }
  return { clientId, clientSecret, accountsUrl: accountsUrl.replace(/\/+$/, ''), redirectUri };
}

// The consent URL a person opens to connect their Zoho. The callback stores the token under the
// person who is signed in to the dashboard (from the session), not from any value in the URL, so the
// `state` parameter is left for the CSRF-state wrapper (app/api/_lib/oauthState) to fill.
export function authUrl() {
  const { clientId, accountsUrl, redirectUri } = cfg();
  const url = new URL(`${accountsUrl}/oauth/v2/auth`);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export async function exchangeCode(code: string, email: string) {
  const { clientId, clientSecret, accountsUrl, redirectUri } = cfg();
  const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
    signal: AbortSignal.timeout(30000),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code }),
  });
  const tokens: any = await res.json();
  if (!res.ok || tokens.error || !tokens.refresh_token) throw new Error(`Zoho Projects connect failed: ${JSON.stringify(tokens)}`);
  tokens.obtained_at = Date.now();
  await writeTokens(provider(email), tokens);
  return { ok: true };
}

export const isConnected = (email: string) => hasTokens(provider(email));

async function accessToken(email: string): Promise<string> {
  const p = provider(email);
  const tokens: any = await readTokens(p);
  if (!tokens) throw new Error('This person has not connected their Zoho yet.');
  const ageSeconds = (Date.now() - (tokens.obtained_at || 0)) / 1000;
  if (ageSeconds > (tokens.expires_in || 3600) - 120) {
    const { clientId, clientSecret, accountsUrl } = cfg();
    const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
      signal: AbortSignal.timeout(30000),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token }),
    });
    const refreshed: any = await res.json();
    if (!res.ok || refreshed.error) throw new Error(`Zoho Projects token refresh failed: ${JSON.stringify(refreshed)}`);
    const merged = { ...tokens, ...refreshed, obtained_at: Date.now() };
    await writeTokens(p, merged);
    return merged.access_token;
  }
  return tokens.access_token;
}

// A Zoho Projects REST call with the person's token.
async function zoho(email: string, path: string, method: 'GET' | 'POST', params?: Record<string, string>) {
  const token = await accessToken(email);
  const url = new URL(`${API}${path}`);
  if (method === 'GET' && params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(30000),
    method,
    headers: { Authorization: `Zoho-oauthtoken ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: method === 'POST' && params ? new URLSearchParams(params) : undefined,
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(`Zoho ${path}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

// The "General" task in a project (found by name, or created once).
async function generalTaskId(email: string, projectId: string): Promise<string> {
  const list = await zoho(email, `/restapi/portal/${PORTAL}/projects/${projectId}/tasks/`, 'GET', { range: '200' });
  const tasks: any[] = list?.tasks || [];
  const found = tasks.find((t) => String(t.name || '').trim().toLowerCase() === 'general');
  if (found) return String(found.id_string || found.id);
  const created = await zoho(email, `/restapi/portal/${PORTAL}/projects/${projectId}/tasks/`, 'POST', { name: 'General' });
  const t = created?.tasks?.[0];
  return String(t?.id_string || t?.id);
}

const two = (n: number) => String(n).padStart(2, '0');
const toHHMM = (hours: number) => `${two(Math.floor(hours))}:${two(Math.round((hours - Math.floor(hours)) * 60))}`;
// day is YYYY-MM-DD; Zoho wants MM-dd-yyyy.
const toMMDDYYYY = (day: string) => { const [y, m, d] = day.split('-'); return `${m}-${d}-${y}`; };

// Log hours for a person to their project's General task for a day.
export async function logTime(email: string, projectId: string, day: string, hours: number, notes = 'Recorded by the activity watcher') {
  if (hours <= 0) return { ok: false, reason: 'no hours' };
  const taskId = await generalTaskId(email, projectId);
  const res = await zoho(email, `/restapi/portal/${PORTAL}/projects/${projectId}/tasks/${taskId}/logs/`, 'POST', {
    date_format: 'MM-dd-yyyy',
    date: toMMDDYYYY(day),
    bill_status: 'Non Billable',
    hours: toHHMM(hours),
    notes,
  });
  const log = res?.timelogs?.date?.[0]?.tasklogs?.[0] || res?.tasklogs?.[0] || null;
  return { ok: true, zohoLogId: log ? String(log.id_string || log.id) : null };
}

// Parse a stored UTC timestamp ("YYYY-MM-DD HH:MM:SS") into ms.
const parseUtcMs = (s: any): number | null => {
  const t = Date.parse(String(s || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : null;
};

// Log one person's hours for a day to their team's project General task. Hours = attendance span
// (first watcher report to last). Runs once per day: if logged_at is already set, it does nothing.
// Returns a small result object (never throws for the expected "nothing to do" cases).
export async function syncPersonDay(email: string, day: string = istDay()) {
  const who = email.toLowerCase();
  if (!(await isConnected(who))) return { email: who, ok: false, reason: 'Zoho not connected' };
  const member = await prisma.team_members.findUnique({ where: { email: who }, select: { team: true, role: true } });
  if (!member || member.role === 'admin') return { email: who, ok: false, reason: 'not a tracked person' };
  const projectId = member.team ? PROJECT_BY_TEAM[member.team] : null;
  if (!projectId) return { email: who, ok: false, reason: `no project mapped for team "${member.team || '(none)'}"` };
  const att = await prisma.work_attendance.findUnique({ where: { email_day: { email: who, day } } });
  if (!att) return { email: who, ok: false, reason: `no attendance recorded on ${day}` };
  if (att.logged_at) return { email: who, ok: false, reason: 'already logged', zohoLogId: att.zoho_log_id };
  const first = parseUtcMs(att.first_at);
  const last = parseUtcMs(att.last_at);
  const ms = first !== null && last !== null && last > first ? last - first : 0;
  const hours = Math.round((ms / 3600000) * 100) / 100;
  if (hours <= 0) return { email: who, ok: false, reason: 'zero hours' };
  const res = await logTime(who, projectId, day, hours, `Attendance ${day} (recorded by the activity watcher)`);
  await prisma.work_attendance.update({ where: { email_day: { email: who, day } }, data: { logged_at: sqlNow(), zoho_log_id: res.zohoLogId || null } });
  return { email: who, ok: true, hours, projectId, zohoLogId: res.zohoLogId || null };
}

// Log every tracked person's hours for a day (the once-a-day job; usually the previous day).
export async function syncAllDay(day: string = istDay()) {
  const people = await prisma.team_members.findMany({ where: { role: { not: 'admin' }, blocked: false }, select: { email: true } });
  const out: any[] = [];
  for (const p of people) {
    try {
      out.push(await syncPersonDay(p.email, day));
    } catch (e: any) {
      out.push({ email: p.email.toLowerCase(), ok: false, error: e.message });
    }
  }
  return out;
}
