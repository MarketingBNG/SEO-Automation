// Training enrollment: create/manage the training_profiles that put a non-admin person into the training
// and SEB program, from the dashboard instead of the Coolify terminal. The same functions back the admin
// page (app/api/training/admin), the optional auto-enroll on login (lib/auth), and scripts/qa-seb.ts.
//
// A "training profile" is a training_profiles row (level, active). Whether a person is in training at all
// is role-based: isTrainee(role) is everyone but the admin. "blocked" is on team_members, not the profile.
// These functions are pure data + audit; the API route enforces who may call them (admin/manager rules).
import prismaClient from './prisma';
import * as activity from './activity';
import * as settings from './settings';
import { MAX_LEVEL } from './associateTraining';
import { isTrainee } from './trainingContent';

const prisma: any = prismaClient;

const DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'usaindiacfo.com').toLowerCase();
export const isCompanyEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.toLowerCase().endsWith('@' + DOMAIN);
export const clampLevel = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_LEVEL, Math.max(1, v)) : 1;
};

export type EnrolledRow = {
  email: string; name: string | null; role: string; team: string | null;
  blocked: boolean; enrolled: boolean; level: number | null; active: boolean | null; enrolledAt: string | null;
};

// Every non-admin team member, with their training-profile state (enrolled? level? active?). The admin is
// never shown here: the admin does not take the training.
export async function listEnrolled(): Promise<EnrolledRow[]> {
  const [members, profiles] = await Promise.all([
    prisma.team_members.findMany({ orderBy: [{ email: 'asc' }] }),
    prisma.training_profiles.findMany(),
  ]);
  const byEmail = new Map<string, any>(profiles.map((p: any) => [p.email, p]));
  return members
    .filter((m: any) => isTrainee(m.role))
    .map((m: any): EnrolledRow => {
      const p = byEmail.get(m.email);
      return {
        email: m.email, name: m.name || p?.name || null, role: m.role, team: m.team || null,
        blocked: Boolean(m.blocked), enrolled: Boolean(p), level: p?.level ?? null,
        active: p ? Boolean(p.active) : null, enrolledAt: p?.created_at || null,
      };
    });
}

// Ensure a training profile exists for a team member (does not change role/team). Idempotent: if one
// exists it is returned unchanged (never duplicated). Returns whether it was created.
export async function ensureProfile(email: string, opts: { level?: number; name?: string | null; actor: string }): Promise<{ created: boolean; profile: any }> {
  const who = email.toLowerCase();
  const existing = await prisma.training_profiles.findUnique({ where: { email: who } });
  if (existing) return { created: false, profile: existing };
  const level = clampLevel(opts.level ?? 1);
  const profile = await prisma.training_profiles.create({ data: { email: who, name: opts.name || null, level, active: true } });
  await activity.log('training.enrolled', { details: `${who}: enrolled at level ${level}`, actor: opts.actor });
  return { created: true, profile };
}

export async function setActive(email: string, active: boolean, actor: string): Promise<void> {
  const who = email.toLowerCase();
  const r = await prisma.training_profiles.updateMany({ where: { email: who }, data: { active } });
  if (r.count) await activity.log('training.enroll_changed', { details: `${who}: ${active ? 'activated' : 'paused'}`, actor });
}

export async function setLevel(email: string, level: number, actor: string): Promise<void> {
  const who = email.toLowerCase();
  const lv = clampLevel(level);
  const r = await prisma.training_profiles.updateMany({ where: { email: who }, data: { level: lv } });
  if (r.count) await activity.log('training.enroll_changed', { details: `${who}: level set to ${lv}`, actor });
}

// Unblock is on team_members (blocked=false). Block is intentionally not offered here; use the Team page.
export async function unblock(email: string, actor: string): Promise<void> {
  const who = email.toLowerCase();
  const r = await prisma.team_members.updateMany({ where: { email: who, blocked: true }, data: { blocked: false } });
  if (r.count) await activity.log('training.enroll_changed', { details: `${who}: unblocked`, actor });
}

// Optional auto-enroll on first login (behind a setting, default off). Called from the NextAuth jwt
// callback on initial sign-in. Only a non-admin, qualifying-role, company-email person with no profile is
// enrolled at level 1. It never changes roles and never enrolls the admin.
export async function autoEnrollOnLogin(email: string, name: string | null, role: string): Promise<void> {
  try {
    if (!role || role === 'admin' || !isTrainee(role) || !isCompanyEmail(email)) return;
    if (String((await settings.get('auto_enroll_on_login')) || '').trim() !== 'on') return;
    const roles = String((await settings.get('auto_enroll_roles')) || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (roles.length && !roles.includes(role)) return;
    const who = email.toLowerCase();
    if (await prisma.training_profiles.findUnique({ where: { email: who } })) return;
    await prisma.training_profiles.create({ data: { email: who, name: name || null, level: 1, active: true } });
    await activity.log('training.auto_enrolled', { details: `${who}: auto-enrolled on login (level 1, role ${role})`, actor: 'system' });
  } catch {
    // Auto-enroll is best-effort and must never block sign-in.
  }
}
