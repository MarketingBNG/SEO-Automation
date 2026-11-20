// The daily training gate: for a person in the training (everyone but the admin, with an active
// profile), while today's training is not finished (a lesson of today not marked read, or a test of
// today not submitted), every dashboard page except Associate Training is locked and their API
// writes outside the training are refused (proxy.ts). It fails open: with no lesson and no test for
// today (lessons not made yet, Testing mode, AI paused, an error), nobody is locked out; a notice says
// so instead. The admin's "In training" switch (active) removes the gate for a person.
import prisma from './prisma';
import { TRACK_LABEL, isTrainee, lessonIdsOf, type Track } from './trainingContent';

const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);

export const GATE_MESSAGE = "Finish today's training to open the dashboard";
export type Gate = { locked: boolean; unread: { id: number; title: string; track: string }[]; openTests: { id: number; kind: string }[]; notice: string | null };
const OPEN: Gate = { locked: false, unread: [], openTests: [], notice: null };

// Cached 30 seconds per person (the proxy asks on every API write); shared across bundles through
// globalThis so marking a lesson read or submitting a test unlocks at once.
const g = globalThis as unknown as { __trainingGate?: Map<string, { at: number; day: string; value: Gate }> };
const cache = (g.__trainingGate ||= new Map());
export const forgetGate = (email?: string) => (email ? cache.delete(email.toLowerCase()) : cache.clear());

export async function trainingGate(email: string, role: string, day = istDay()): Promise<Gate> {
  const e = String(email || '').toLowerCase();
  if (!e || !isTrainee(role)) return OPEN;
  const hit = cache.get(e);
  if (hit && hit.day === day && Date.now() - hit.at < 30_000) return hit.value;
  const value = await computeGate(e, day).catch(() => OPEN);
  cache.set(e, { at: Date.now(), day, value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

async function computeGate(email: string, day: string): Promise<Gate> {
  const p = await prisma.training_profiles.findUnique({ where: { email } });
  if (!p || !p.active) return OPEN;
  const ids = Object.values(lessonIdsOf(p)).filter((x): x is number => Boolean(x));
  const todays = ids.length ? await prisma.training_lessons.findMany({ where: { id: { in: ids }, day }, select: { id: true, title: true, track: true } }) : [];
  const read = new Set((await prisma.training_reads.findMany({ where: { email, lesson_id: { in: todays.map((l) => l.id) } }, select: { lesson_id: true } })).map((r) => r.lesson_id));
  const unread = todays.filter((l) => !read.has(l.id)).map((l) => ({ id: l.id, title: l.title, track: TRACK_LABEL[l.track as Track] || l.track }));
  const openTests = (await prisma.training_tests.findMany({ where: { email, day, status: 'open' }, select: { id: true, kind: true } })).map((t) => ({ id: t.id, kind: t.kind }));
  if (!todays.length && !openTests.length) {
    return { ...OPEN, notice: "Today's training is not ready yet (lessons are made after 09:00 IST, and wait while AI work is paused or in Testing mode). The dashboard stays open meanwhile." };
  }
  return { locked: unread.length > 0 || openTests.length > 0, unread, openTests, notice: null };
}

// API paths a locked person may still write to: the training itself (sign-in and sign-out are public).
export const allowedWhileLocked = (path: string) => /^\/api\/associate-training(\/|$)/.test(path) || /^\/api\/auth(\/|$)/.test(path);

// proxy.ts: the refusal for an API write by a person whose training today is not finished, or null.
// Reads stay open (the page shows the lock); the training's own routes stay open.
export async function gateRefusal(method: string, path: string, email: string | null | undefined, role: string, day?: string): Promise<{ status: number; body: any } | null> {
  const write = method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD';
  if (!write || !email || !isTrainee(role) || allowedWhileLocked(path)) return null;
  const gate = await trainingGate(email, role, day);
  return gate.locked ? { status: 403, body: { error: `${GATE_MESSAGE}: ${[gate.unread.length ? `read ${gate.unread.length} lesson(s)` : '', gate.openTests.length ? `submit ${gate.openTests.length} test(s)` : ''].filter(Boolean).join(' and ')} on Associate Training.`, trainingGate: true } } : null;
}
