// The monitoring terms every employee accepts once (DPDP consent). The admin does not take it.
// Bump CONSENT_VERSION when the terms below change: everyone is then asked to accept the new version.
import prismaClient from './prisma';

const prisma: any = prismaClient;

export const CONSENT_VERSION = '2';
export const CONSENT_TITLE = 'Before you start: how this laptop and dashboard work';
// The plain, honest list the person reads and agrees to. Keep it truthful: whatever the system does
// is here, nothing hidden. If the device setup changes what is recorded, change this and bump the
// version.
export const CONSENT_POINTS = [
  'Your attendance is recorded from when you sign in and sign out on this laptop.',
  'During work hours, which app or window is open and for how long is recorded, only to fill your timesheet. Screenshots, keystrokes and passwords are NOT recorded.',
  'Your Zoho timesheet is filled automatically from this.',
  'During work hours, until you finish the day’s training (the lesson, and the test on test days), this company laptop stays on the training screen and other apps are not open. As soon as you click Finish/Complete, the laptop unlocks for the rest of the day. Sundays and holidays have no lesson.',
  'Your training lessons and tests, including the time taken and the answers, are reviewed by your manager and the admin.',
  'This information is visible to your employer.',
];

// Everyone signs the terms except the admin (the owner, who runs the monitoring).
export const consentNeededForRole = (role: string) => role !== 'admin';

export async function hasConsent(email: string, version = CONSENT_VERSION): Promise<boolean> {
  if (!email) return false;
  const row = await prisma.training_consents.findUnique({ where: { email_version: { email: email.toLowerCase(), version } } });
  return Boolean(row);
}

export async function recordConsent(email: string, version = CONSENT_VERSION) {
  const e = String(email || '').toLowerCase();
  if (!e) throw Object.assign(new Error('Not signed in'), { status: 401 });
  await prisma.training_consents.upsert({ where: { email_version: { email: e, version } }, create: { email: e, version }, update: {} });
  return { ok: true };
}
