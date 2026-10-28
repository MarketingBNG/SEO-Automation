// Loaded before every test file (npm test: --import ./tests/setup.ts).
// AI requests in tests run in Live mode (against stubbed fetch), whatever ai_mode the database holds:
// in Testing mode they would wait in the Claude Code queue (ai_jobs) forever. See lib/aiQueue.ts.
(globalThis as any).__AI_MODE_PIN = 'live';
