// Assign / clear a short, disposable QA test ("QA — SEB Automatic Exit") for ONE enrolled person, to
// test the real /seb/finish -> quit flow without touching any official record.
//
//   npx tsx scripts/qa-seb.ts status <email>     gate + QA test today + the SEB quit URL (read-only)
//   npx tsx scripts/qa-seb.ts assign <email>     create today's QA test (kind 'qa') for that person
//   npx tsx scripts/qa-seb.ts clear  <email>     delete today's QA test for that person
//   npx tsx scripts/qa-seb.ts quit-url           print the resolved SEB quit URL (read-only)
//   npx tsx scripts/qa-seb.ts set-quit-url <url> set the seb_quit_url setting (overrides env + default)
//   npx tsx scripts/qa-seb.ts clear-quit-url     remove the setting so the built-in default is used
//
// Needs DATABASE_URL pointing at the same Postgres the dashboard uses (run it in the app's environment).
// Run by an admin only. It is scoped to the one email you pass. The QA test:
//   - is kind 'qa', for TODAY (IST), status 'open', so the gate returns "pending" and /seb shows it;
//   - uses the hand-written MCQs below (no AI, no paid calls);
//   - is excluded from official scores, the team report, the adaptive level, attendance and Zoho sync
//     (lib/associateTraining submitTest qa-path, lib/associateTrainingView, app/api/seb/finish);
//   - expires on completion (status leaves 'open') or at the end of the IST day (the gate only looks at
//     today), so it never carries over;
//   - does NOT touch the person's lessons, reads, real tests, points or level.
import prismaClient from '../lib/prisma';
import { gateForEmail } from '../lib/worklog';
import { resolveSebQuitUrl, DEFAULT_SEB_QUIT_URL } from '../lib/seb';
import * as settings from '../lib/settings';
import { lessonIdsOf } from '../lib/trainingContent';

const prisma: any = prismaClient;
const EXPECTED_QUIT_URL = 'https://seo.usaindiacfo.us/seb/quit';
const istDay = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const QA_KIND = 'qa';
const QA_TITLE = 'QA — SEB Automatic Exit';

// Hand-written MCQs (not generated). Short and about this QA itself, so it is obviously a test run.
const QA_QUESTIONS = [
  { id: 'qa-exit', q: 'After you click Finished on this QA test and the save succeeds, what should happen?', options: ['SEB closes by itself and Windows returns', 'SEB asks for a password', 'Nothing happens'], answer: 0, explain: 'A confirmed save returns the quit URL and SEB exits.', kind: 'mcq' as const },
  { id: 'qa-fail', q: 'If the save fails, what should SEB do?', options: ['Stay open on the test', 'Close anyway', 'Restart Windows'], answer: 0, explain: 'No quit URL is returned on a failed save, so SEB stays open.', kind: 'mcq' as const },
  { id: 'qa-scope', q: 'This QA result is counted in official training scores.', options: ['False — it is a disposable QA test', 'True'], answer: 0, explain: 'QA tests are kept out of scores, attendance and Zoho sync.', kind: 'mcq' as const },
];

async function quitUrlInfo() {
  const raw = await settings.get('seb_quit_url');
  const resolved = await resolveSebQuitUrl();
  return { resolvedQuitUrl: resolved, rawSetting: raw ?? null, envSet: Boolean(process.env.SEB_QUIT_URL), builtInDefault: DEFAULT_SEB_QUIT_URL, matchesExpected: resolved === EXPECTED_QUIT_URL };
}

async function quitUrl() {
  const info = await quitUrlInfo();
  console.log(JSON.stringify(info, null, 2));
  if (!info.matchesExpected) console.log(`\nWARNING: the resolved quit URL is not ${EXPECTED_QUIT_URL}. SEB will not exit unless this matches the VM's SEB profile quitURL. Fix with: set-quit-url ${EXPECTED_QUIT_URL}  (or clear-quit-url to use the built-in default).`);
}

async function status(email: string) {
  const who = email.toLowerCase();
  const prof = await prisma.training_profiles.findUnique({ where: { email: who } });
  const member = await prisma.team_members.findUnique({ where: { email: who }, select: { role: true, name: true, blocked: true } });
  const day = istDay();
  const qa = await prisma.training_tests.findUnique({ where: { email_day_kind: { email: who, day, kind: QA_KIND } } }).catch(() => null);
  const reads = await prisma.training_reads.count({ where: { email: who } });
  const gate = await gateForEmail(who);
  console.log(JSON.stringify({
    email: who, name: member?.name || null, role: member?.role || null, blocked: member?.blocked || false,
    profile: prof ? { active: prof.active, level: prof.level } : null,
    istDay: day, qaTestToday: qa ? { id: qa.id, status: qa.status, total: qa.total } : null,
    lessonReadRecords: reads, gate: { status: gate.status, locked: gate.locked },
    sebQuitUrl: await quitUrlInfo(),
  }, null, 2));
  if (!prof) console.log('\nNote: no training profile for this email. The gate will not lock and /seb will not show a test.');
  if (prof && !prof.active) console.log('\nNote: training profile is INACTIVE, so the gate stays open. Activate it (admin > In training) for the QA test to show.');
  if (gate.status === 'before-window') console.log('\nNote: it is before 09:00 IST, so the gate is "before-window". After 09:00 IST the QA test shows as "pending".');
}

async function assign(email: string) {
  const who = email.toLowerCase();
  const prof = await prisma.training_profiles.findUnique({ where: { email: who } });
  if (!prof) { console.error(`No training profile for ${who}. Refusing to assign (verify the exact enrolled account first).`); process.exit(1); }
  const day = istDay();
  const questions = JSON.stringify(QA_QUESTIONS);
  // kind 'qa' is isolated by the @@unique([email, day, kind]) key, so it never collides with the real
  // daily/surprise test. lesson_ids is a sentinel ',0,' (not null) so the gate counts it as an open test;
  // it maps to no real lesson, so it never looks like a lesson was tested.
  // created_at is stamped to early morning IST (07:30) so the test is never treated as "made late" (the
  // gate ignores training generated after 13:00 IST). A QA test must always lock today, whatever the hour
  // it is assigned, so the gate returns "pending" and /seb shows it.
  const row = await prisma.training_tests.upsert({
    where: { email_day_kind: { email: who, day, kind: QA_KIND } },
    create: { email: who, day, level: prof.level, questions, total: QA_QUESTIONS.length, status: 'open', kind: QA_KIND, lesson_ids: ',0,', created_at: `${day} 02:00:00` },
    update: { questions, total: QA_QUESTIONS.length, status: 'open', score: null, answers: null, submitted_at: null, created_at: `${day} 02:00:00` },
  });
  const { forgetGate } = await import('../lib/trainingGate');
  forgetGate(who);
  console.log(`Assigned "${QA_TITLE}" (test #${row.id}, kind ${QA_KIND}) to ${who} for ${day} IST.`);
  await status(who);
}

async function clear(email: string) {
  const who = email.toLowerCase();
  const day = istDay();
  const r = await prisma.training_tests.deleteMany({ where: { email: who, day, kind: QA_KIND } });
  const { forgetGate } = await import('../lib/trainingGate');
  forgetGate(who);
  console.log(`Cleared ${r.count} QA test(s) for ${who} on ${day} IST.`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'quit-url') { await quitUrl(); return; }
  if (cmd === 'set-quit-url') {
    if (!arg) { console.error('Usage: npx tsx scripts/qa-seb.ts set-quit-url <url>'); process.exit(1); }
    await settings.set('seb_quit_url', arg);
    console.log(`Set seb_quit_url to ${arg}.`);
    await quitUrl();
    return;
  }
  if (cmd === 'clear-quit-url') {
    await prisma.settings.deleteMany({ where: { key: 'seb_quit_url' } });
    console.log('Cleared the seb_quit_url setting; the built-in default now applies.');
    await quitUrl();
    return;
  }
  if (!cmd || !arg) { console.error('Usage: npx tsx scripts/qa-seb.ts <status|assign|clear> <email> | quit-url | set-quit-url <url> | clear-quit-url'); process.exit(1); }
  if (cmd === 'status') await status(arg);
  else if (cmd === 'assign') await assign(arg);
  else if (cmd === 'clear') await clear(arg);
  else { console.error(`Unknown command "${cmd}". Use status | assign | clear | quit-url | set-quit-url | clear-quit-url.`); process.exit(1); }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
