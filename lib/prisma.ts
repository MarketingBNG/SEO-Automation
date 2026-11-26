import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from './generated/prisma/client';

// One client (and one connection pool) per server process, talking to Coolify Postgres. Kept on
// globalThis in production too: proxy.ts and the route handlers are separate bundles, and each made
// its own client and its own pool of 10 connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; __seoPgPool?: pg.Pool };

// PG_POOL_MAX: connections this server keeps open (default 10). With more than one container, or
// behind PgBouncer, the total across containers must stay under Postgres max_connections.
// PG_POOL_WAIT_MS: how long a query waits for a free connection before it fails (default 10 s);
// without it a query waited forever and requests piled up behind the pool under heavy load.
const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  // One explicit pool per process, shared with proxy.ts: at most PG_POOL_MAX connections (Postgres allows 100 in
  // total, and the cluster runs several processes), a bounded wait for a free connection (PG_POOL_WAIT_MS), idle
  // connections released, and no query running forever.
  const pool = new pg.Pool({
    connectionString,
    max: num(process.env.PG_POOL_MAX, 15),
    connectionTimeoutMillis: num(process.env.PG_POOL_WAIT_MS, 10_000),
    idleTimeoutMillis: 30_000,
    statement_timeout: 60_000,
  });
  // An idle connection dropped by Postgres (restart, network) must not crash the server.
  pool.on('error', () => {});
  globalForPrisma.__seoPgPool = pool;
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

export const prisma = globalForPrisma.prisma ?? createClient();
globalForPrisma.prisma = prisma;

export default prisma;
