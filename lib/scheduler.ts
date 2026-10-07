// Built-in scheduler, started once when the server starts (instrumentation.ts), so the automation
// runs on the self-hosted server without depending on a Coolify Scheduled Task being set up:
//  - every 15 minutes: the daily autopilot (drafts, review windows, publishing, fixes, speed, outreach,
//    rank check; each step has its own once-a-day guard where needed),
//  - Mondays: plan vs actual (once per Monday),
//  - daily: a new strategy is generated when none covers the coming 3 days (it still needs approval).
// An external cron calling the same routes is still safe: overlapping runs are skipped.
// Set BUILTIN_SCHEDULER=off to disable.
const EVERY_MS = 15 * 60 * 1000;

declare global {
  var __seoScheduler: NodeJS.Timeout | undefined;
}

async function tick() {
  const [{ runDaily, runWeekly }, settings, { default: prisma }, { startStrategyJob }, { strategyWindow }] = await Promise.all([
    import('./strategy/autopilot'),
    import('./settings'),
    import('./prisma'),
    import('./strategy/jobs'),
    import('./strategy/core'),
  ]);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  await runDaily(now).catch((e) => console.error('Scheduler: daily run failed:', e.message));

  if (now.getUTCDay() === 1 && (await settings.get('last_weekly_run')) !== today) {
    const r: any = await runWeekly(now).catch((e) => ({ error: e.message }));
    if (!r?.error) await settings.set('last_weekly_run', today);
  }

  if ((await settings.get('last_strategy_check')) !== today) {
    const soon = new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    const covering = await prisma.seo_strategies.findFirst({
      where: { status: { in: ['pending_review', 'approved', 'generating', 'paused'] }, end_date: { gte: soon } },
      select: { id: true },
    });
    if (!covering) await startStrategyJob({ window: strategyWindow(now), actor: 'Automatic run' }).catch((e: any) => console.error('Scheduler: strategy run failed:', e.message));
    await settings.set('last_strategy_check', today);
  }
}

export function startScheduler() {
  if (process.env.BUILTIN_SCHEDULER === 'off' || globalThis.__seoScheduler) return;
  // Blog generations run inside this server process; any still marked as running from before a
  // restart cannot finish, so they are marked failed (with a clear reason) to be generated again.
  import('./prisma')
    .then(({ default: prisma }) =>
      prisma.keywords.updateMany({ where: { status: 'generating' }, data: { status: 'failed', error: 'Interrupted by a server restart or deploy. Click Generate again.', progress_stage: null, progress_percent: null } })
    )
    .catch(() => {});
  const run = () => tick().catch((e) => console.error('Scheduler error:', e?.message || e));
  // First run a minute after start, so the server is fully up.
  setTimeout(run, 60 * 1000);
  globalThis.__seoScheduler = setInterval(run, EVERY_MS);
  console.log('Built-in scheduler started (every 15 minutes).');
}
