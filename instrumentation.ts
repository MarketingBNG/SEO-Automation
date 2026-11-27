// Runs once when the server starts. On the Node.js server: the overload guard (lib/overload.ts)
// and the built-in scheduler.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Prefer IPv4 for outgoing connections. On a server whose IPv6 does not route, Node's fetch tries the
    // IPv6 address first (Google APIs have one) and fails with "fetch failed" (seen on GA4).
    const dns = await import('node:dns');
    dns.setDefaultResultOrder('ipv4first');
    const net = await import('node:net');
    if (typeof net.setDefaultAutoSelectFamily === 'function') net.setDefaultAutoSelectFamily(true);
    const { installOverloadGuard } = await import('./lib/overload');
    installOverloadGuard();
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
