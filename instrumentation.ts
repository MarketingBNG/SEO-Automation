// Runs once when the server starts. On the Node.js server: the overload guard (lib/overload.ts)
// and the built-in scheduler.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installOverloadGuard } = await import('./lib/overload');
    installOverloadGuard();
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
