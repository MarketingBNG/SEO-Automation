# Team Training and timesheet: plan and decisions

This is the agreed plan from the 2026-11-20/21 discussion. It records what is already built and
deployed, what is still to build, and the rollout order. It is a plan, not code.

## Already built and deployed to main (2026-11-21)

- Teams (Marketing, Automation) and manager scoping: a manager sees the training report, person
  pages and finished tests of their own team only; the admin sees everyone.
- Capture during lessons and tests: how long each lesson and test took, the full trail of answers
  picked and changed, and AI-use signals (pastes, tab-switches, time away).
- Report to admin and managers: timing, answer trail, AI-use flags (red "check" on a suspicious
  test), and automatic level up / same / down with the reason.
- Remarks: admin on anyone, manager on their team; the person does not see them.
- Live test view: the admin and managers watch tests being taken, refreshing every few seconds.
- One-time consent screen (everyone except the admin), recorded with name, version and date.
- Worklog backend (storage + endpoints only; no UI, no Zoho, no watcher yet).
- Lesson content: added Indian forms (Form 16/16A, Form 13, Form 10F/TRC, 26AS/AIS) and a required
  worked example in every technical lesson.

A website cannot lock a device or record other apps. The consent screen only covers the dashboard.
Device-level blocking, auto-login, Zoho check-in and the activity watcher all need the Windows
program installed on the laptop (Phase 7, not built yet).

## Training schedule

### Weekly pattern (the normal week)
- Monday, Tuesday: lessons
- Wednesday: test (on Monday + Tuesday lessons)
- Thursday, Friday: lessons
- Saturday: test (on Thursday + Friday lessons)
- Sunday: off

### Rollout
- This week: lessons only, no test.
- Next week: the weekly pattern above. The first test is Wednesday.
- Typed questions + AI grading go live from that first test (Wednesday), not December.
- The week after: add surprise/random tests, twice a week.
- From December: the full per-person pattern below (stagger, leave handling, monthly grand test).

### From December: per-person
- Same level, same content, different days: everyone at a level learns the same set of lessons over
  the month, but not necessarily on the same day (staggered per person). By month end everyone at a
  level has covered the same lessons.
- Tests are per person and on different days (randomised), and only on lessons that person has
  actually read. Each person's test is their own.
- Leave handling: on a day a person is on leave, no test for them that day, and that day's lesson is
  carried so they read it when they return. (Open: how leave is detected - see below.)
- Monthly grand test on the last Monday of the month, covering everything learned that month.

## Questions and marking

- Tests have both multiple-choice and typed (written-answer) questions.
- Multiple-choice: marked automatically (as now).
- Typed: the AI reads and scores each answer (uses Anthropic API credits; cost estimate to be given
  before building).
- Typed answers also track keystrokes, backspaces, time to write, and a basic spelling-mistake count
  (spelling check is approximate).
- The AI uses the admin/manager remarks as feedback to improve lessons and tests over time.
- Level up / down is judged by the AI from performance (timing, edits, AI-use signals, typed-answer
  quality), not only the score formula. Trainees must not use AI themselves; that is flagged.

## Device side (Phase 7, not built)

- 7b: each employee connects their own Zoho Projects once (button on their dashboard); pull their
  task list; push each work block to their Zoho timesheet (per task, per entry).
- 7c: a "Work" card on the dashboard (connect Zoho, pick current task, see today's time) and a
  visible "recording on" indicator.
- 7d: the Windows setup script, run once per laptop (admin rights): lock the device to only the
  dashboard (kiosk), auto-open it, auto-login, Zoho check-in, and the activity watcher that reports
  active time per task. Reversible, with an unlock command. Test on one spare laptop first.

## Open items to confirm

- Leave detection source: (a) Zoho People attendance (needs Zoho People connected), (b) admin or
  manager marks the leave, or (c) auto (no activity that day = leave).
- Deploy timing for the device side: test on one employee's laptop and one spare before any wider
  rollout.
