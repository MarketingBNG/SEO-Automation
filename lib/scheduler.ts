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
  // Heartbeat for the status light in the dashboard header: written at the start of every tick
  // (even when a long run from an earlier tick is still going), and the outcome when it ends.
  await settings.set('scheduler_heartbeat', now.toISOString()).catch(() => {});
  const daily: any = await runDaily(now).catch((e) => ({ errors: [`Daily run failed: ${e.message}`] }));
  if (daily && !daily.skipped) {
    const errors: string[] = [...(daily.errors || [])];
    for (const k of ['fixes', 'outreach', 'speed', 'siteChecks', 'meetings', 'rankAlerts']) if (daily[k]?.error) errors.push(`${k}: ${daily[k].error}`);
    await settings.set('scheduler_last_run', JSON.stringify({ at: new Date().toISOString(), errors: errors.slice(0, 10), opened: daily.opened || 0, published: daily.published || 0, drafted: daily.drafted || 0, held: daily.held || 0 })).catch(() => {});
  }
  // AI work paused for credits: starts again by itself once a key works again (top-up or the
  // secondary key), reusing the steps already done. Old saved steps are cleaned up.
  const credits = await import('./aiCredits');
  await credits.autoResumeAi().catch((e: any) => console.error('Scheduler: AI auto-resume failed:', e.message));
  const replay = await import('./aiReplay');
  // In Testing mode the scheduler's work cannot use AI: restarting a run there would only spend the
  // paid data lookups before it stops again. Those runs wait until Live mode is back.
  const testing = (await (await import('./aiQueue')).aiMode()) === 'testing';
  if (!testing && (await settings.get('ai_paused')) !== '1') await (await import('./strategy/jobs')).resumeRestarted().catch((e: any) => console.error('Scheduler: strategy restart failed:', e.message));
  if (!testing && (await settings.get('ai_paused')) !== '1') await replay.resumeCreditBlog().catch((e: any) => console.error('Scheduler: credit blog resume failed:', e.message));
  await replay.pruneReplay();
  if ((await settings.get('last_apicache_prune')) !== today) {
    const { pruneApiCache } = await import('./apiCache');
    await pruneApiCache().catch((e: any) => console.error('Scheduler: API cache prune failed:', e.message));
    // Finished Claude Code queue jobs hold the full prompt and are never read again.
    const { sqlNowOffset } = await import('./time');
    await prisma.ai_jobs.deleteMany({ where: { status: { in: ['used', 'cancelled'] }, created_at: { lt: sqlNowOffset('-14 days') } } }).catch((e: any) => console.error('Scheduler: queue prune failed:', e.message));
    await settings.set('last_apicache_prune', today);
  }

  // A blog cut off by a server restart (for example a deploy) is started again automatically.
  const { resumeInterruptedBlog } = await import('./blogJob');
  if (!testing) await resumeInterruptedBlog().catch((e: any) => console.error('Scheduler: blog resume failed:', e.message));

  // Blogs not yet on the website get their banner by themselves (made in the Social Media dashboard).
  const { fillMissingCovers } = await import('./coverPhoto');
  await fillMissingCovers().catch((e: any) => console.error('Scheduler: banners failed:', e.message));

  // Topics: once a day after 10:00 IST.
  const { topicsTick } = await import('./topics');
  await topicsTick(now).catch((e: any) => console.error('Scheduler: topics failed:', e.message));

  // Mondays: the writer and fact-check memories seen once and never used for 180 days are retired.
  if (now.getUTCDay() === 1 && (await settings.get('last_memory_tidy')) !== today) {
    await (await import('./agentMemory')).tidyMemories().catch(() => 0);
    await settings.set('last_memory_tidy', today);
  }

  // Directory listings for the day (per-day count from the approved strategy), after 10:00 IST.
  const { directoriesTick } = await import('./strategy/directories');
  // Not awaited: it runs in batch mode (half price) and can take a while; the rest of the run goes on.
  void directoriesTick(now).catch((e: any) => console.error('Scheduler: directories failed:', e.message));

  // Associate Training: lessons and tests once a day after 09:00 IST.
  const { trainingTick } = await import('./associateTraining');
  await trainingTick(now).catch((e: any) => console.error('Scheduler: training failed:', e.message));

  if (now.getUTCDay() === 1 && (await settings.get('last_weekly_run')) !== today) {
    const r: any = await runWeekly(now).catch((e) => ({ error: e.message }));
    if (!r?.error) await settings.set('last_weekly_run', today);
  }

  // Weekly: keep the tracked keywords topped up, and learn from the week's reviews and results.
  if (now.getUTCDay() === 1 && (await settings.get('last_keyword_topup')) !== today) {
    const { topUpTrackedKeywords } = await import('./keywordTracking');
    // Marked done only when it worked, so an SE Ranking outage is retried on a later tick, not next week
    // (research answers are cached for 24 hours, so a retry does not pay for them again).
    const ok = await topUpTrackedKeywords().then(() => true, (e: any) => (console.error('Scheduler: keyword top-up failed:', e.message), false));
    if (ok) await settings.set('last_keyword_topup', today);
  }
  if (now.getUTCDay() === 1 && (await settings.get('last_lessons_run')) !== today) {
    const { learnLessons } = await import('./lessons');
    const { CreditPausedError } = await import('./aiCredits');
    // Paused credits or Testing mode stop it before any AI call: try again later today. Other failures
    // may come after a paid call, so they are not retried every 15 minutes.
    const paused = await learnLessons().then(() => false, (e: any) => (console.error('Scheduler: lessons failed:', e.message), e instanceof CreditPausedError));
    if (!paused) await settings.set('last_lessons_run', today);
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
  // restart (for example a deploy) cannot finish here. They go back in the queue and the first tick
  // starts them again automatically (strategy blogs are rewritten by the schedule).
  import('./blogJob')
    .then(async ({ requeueOrphanBlogs }) => {
      await requeueOrphanBlogs({ immediate: true });
      // A strategy that was generating has no run here any more: marked so the first tick restarts it.
      await (await import('./strategy/jobs')).markInterrupted();
      // Blogs an older version marked failed for the same reason are queued again too.
      const { default: prisma } = await import('./prisma');
      await prisma.keywords.updateMany({
        where: { status: 'failed', error: { startsWith: 'Interrupted by a server restart' }, OR: [{ batch_name: null }, { NOT: { batch_name: { startsWith: 'Strategy #' } } }] },
        data: { status: 'pending', error: 'The previous run was cut off by a server restart.' },
      });
    })
    .catch(() => {});
  // Everything the scheduler starts is automatic work: in Testing mode it does not use AI (lib/aiQueue.ts).
  const run = () => import('./aiQueue').then(({ runAutomatic }) => runAutomatic(tick)).catch((e) => console.error('Scheduler error:', e?.message || e));
  // First run a minute after start, so the server is fully up.
  setTimeout(run, 60 * 1000);
  globalThis.__seoScheduler = setInterval(run, EVERY_MS);
  console.log('Built-in scheduler started (every 15 minutes).');
}
