import test from 'node:test';
import assert from 'node:assert/strict';

test('multi-core router: stateless traffic is spread, every job and control request stays on the main process', async () => {
  const { poolRoute } = await import('../scripts/pool-route.mjs');
  for (const [m, u] of [['GET', '/'], ['GET', '/seb'], ['GET', '/_next/static/x.js'], ['GET', '/api/seb/today'], ['POST', '/api/seb/finish'], ['POST', '/api/worklog/report'], ['GET', '/api/worklog/gate'], ['GET', '/api/site/v1/posts'], ['POST', '/api/auth/callback/google']]) assert.equal(poolRoute(m, u), true, `${m} ${u}`);
  for (const [m, u] of [['POST', '/api/drafts/5'], ['GET', '/api/progress'], ['GET', '/api/strategy'], ['POST', '/api/strategy/stop'], ['GET', '/api/cron/timesheet-sync'], ['GET', '/api/seb/admin/enrollments'], ['POST', '/api/seb/handoff'], ['POST', '/api/site/v1/import'], ['POST', '/'], ['GET', '/api/seb/../drafts'], ['GET', '/api/seb/%2e%2e/drafts'], ['GET', '/api/associate-training']]) assert.equal(poolRoute(m, u), false, `${m} ${u}`);
});
