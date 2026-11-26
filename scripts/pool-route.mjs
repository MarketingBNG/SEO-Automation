// Which requests any dashboard process may answer (scripts/cluster.mjs). Everything else goes to the main
// process, which runs the jobs and keeps their in-memory state.
export function poolRoute(method, url) {
  const p = (url || '/').split('?')[0];
  if (p.includes('..') || p.includes('%')) return false; // unusual paths: the main process
  if (p.startsWith('/_next/') || p === '/favicon.ico') return true;
  if (p.startsWith('/api/auth/')) return true; // sign-in (stateless JWT sessions)
  if (p.startsWith('/api/site/v1/')) return method === 'GET' || method === 'HEAD'; // the website's content API
  if (p === '/api/worklog/report' || p === '/api/worklog/gate') return true; // every laptop, on a timer
  if (p.startsWith('/api/seb/')) return !p.startsWith('/api/seb/admin') && p !== '/api/seb/handoff'; // the SEB training browser
  if (!p.startsWith('/api/')) return method === 'GET' || method === 'HEAD'; // pages (server-rendered from the database)
  return false;
}

