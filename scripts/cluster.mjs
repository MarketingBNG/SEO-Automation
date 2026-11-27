// Runs the dashboard on several CPU cores (npm start).
//
// One Next.js process uses one CPU core (about 600-800 requests a second). This launcher starts
// WEB_CONCURRENCY processes (default: the number of cores, at most 4) and a small router in front:
//
//  - the MAIN process (the first one) gets every request that runs or controls a job: writing and
//    checking blogs, strategy, publishing, Stop/Pause, the assistant, cron routes, settings... and it
//    alone runs the 15-minute scheduler. Jobs keep their in-memory state (locks, Stop buttons) in one
//    process, exactly as with a single process.
//  - the high-volume, stateless traffic (pages and static files, sign-in, the website's content API,
//    the laptops' activity reports and training gate, the SEB training browser) is spread over all
//    processes.
//
// WEB_CONCURRENCY=1 runs plain `next start` (the old behaviour). A process that exits is restarted.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { poolRoute } from './pool-route.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const PORT = Number(process.env.PORT) || 3000;
// Not HOSTNAME: Docker sets it to the container ID, which can resolve to an IPv6-only address the
// proxy cannot reach (502). LISTEN_HOST overrides; the default listens on every address.
const HOST = process.env.LISTEN_HOST || '0.0.0.0';
const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
const COUNT = Math.max(1, Math.min(Number(process.env.WEB_CONCURRENCY) || Math.min(cores, 4), 16));

if (COUNT === 1) {
  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT), '-H', HOST], { stdio: 'inherit', env: process.env });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  startCluster();
}

function startCluster() {
  const base = PORT + 1;
  const workers = Array.from({ length: COUNT }, (_, i) => ({ i, port: base + i, ready: false, child: null, restarts: 0 }));
  let stopping = false;

  const launch = (w) => {
    const env = { ...process.env, PORT: String(w.port), WORKER_INDEX: String(w.i) };
    // Only the main process runs the scheduler (and its start-up recovery of interrupted jobs).
    if (w.i !== 0) env.BUILTIN_SCHEDULER = 'off';
    w.ready = false;
    w.child = spawn(process.execPath, [nextBin, 'start', '-p', String(w.port), '-H', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'inherit'], env });
    w.child.stdout.on('data', (d) => {
      process.stdout.write(`[web${w.i}] ${d}`);
      if (/Ready in|started server|Local:/i.test(String(d))) w.ready = true;
    });
    // In case the start-up line changes: count a process still running after 25 s as ready.
    const child = w.child;
    setTimeout(() => { if (w.child === child && child.exitCode === null) w.ready = true; }, 25000).unref();
    w.child.on('exit', (code, sig) => {
      w.ready = false;
      if (stopping) return;
      w.restarts++;
      console.error(`[cluster] web${w.i} exited (${sig || code}); restarting in ${Math.min(30, w.restarts * 2)} s`);
      setTimeout(() => launch(w), Math.min(30000, w.restarts * 2000));
    });
  };
  workers.forEach(launch);

  let rr = 0;
  const pick = (pool) => {
    if (!pool) return workers[0];
    for (let n = 0; n < workers.length; n++) {
      const w = workers[rr++ % workers.length];
      if (w.ready) return w;
    }
    return workers[0];
  };

  const server = http.createServer((req, res) => {
    const w = pick(poolRoute(req.method, req.url));
    const headers = { ...req.headers };
    const ip = req.socket.remoteAddress || '';
    headers['x-forwarded-for'] = headers['x-forwarded-for'] ? `${headers['x-forwarded-for']}, ${ip}` : ip;
    const up = http.request({ host: '127.0.0.1', port: w.port, method: req.method, path: req.url, headers }, (r) => {
      res.writeHead(r.statusCode || 502, r.statusMessage, r.headers);
      r.pipe(res);
    });
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '5' });
      res.end(JSON.stringify({ error: 'The dashboard is restarting. Try again in a few seconds.' }));
    });
    req.on('aborted', () => up.destroy());
    req.pipe(up);
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.listen(PORT, HOST, () => console.log(`[cluster] ${COUNT} processes behind http://${HOST}:${PORT} (web0 runs jobs and the scheduler)`));

  const stop = (sig) => {
    stopping = true;
    server.close();
    for (const w of workers) w.child?.kill(sig);
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
