import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

// One client per server instance (and per dev hot-reload), talking to Coolify Postgres.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  // An explicit pool: at most PG_POOL_MAX connections per process (Postgres allows 100 in total), a
  // bounded wait for a free connection, idle connections released, and no query running forever.
  const max = Number(process.env.PG_POOL_MAX) || 15;
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000, statement_timeout: 60000 }),
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
