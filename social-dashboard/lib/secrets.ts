// API keys live in the database, encrypted with AES-256-GCM. Only two values stay in the
// Coolify environment: DATABASE_URL and SECRETS_ENCRYPTION_KEY (a 64-char hex string).
// Keys are added with `npm run secrets -- import <file>` from the Coolify terminal, never in code.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  return pool;
}

function key(): Buffer {
  const hex = process.env.SECRETS_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('SECRETS_ENCRYPTION_KEY must be 64 hex characters');
  return Buffer.from(hex, 'hex');
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(stored: string): string {
  const [iv, tag, data] = stored.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

async function ensureTable(p: Pool) {
  await p.query(`CREATE TABLE IF NOT EXISTS app_secrets (
    name TEXT PRIMARY KEY,
    value_encrypted TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

export async function setSecret(name: string, value: string): Promise<void> {
  const p = db();
  if (!p) throw new Error('DATABASE_URL is not set');
  await ensureTable(p);
  await p.query(
    `INSERT INTO app_secrets (name, value_encrypted) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET value_encrypted = EXCLUDED.value_encrypted, updated_at = now()`,
    [name, encrypt(value)],
  );
}

export async function deleteSecret(name: string): Promise<void> {
  const p = db();
  if (!p) throw new Error('DATABASE_URL is not set');
  await ensureTable(p);
  await p.query('DELETE FROM app_secrets WHERE name = $1', [name]);
}

/** Names of stored secrets (never values). Empty when the database is not configured. */
export async function listSecretNames(): Promise<string[]> {
  const p = db();
  if (!p) return [];
  await ensureTable(p);
  const r = await p.query<{ name: string }>('SELECT name FROM app_secrets ORDER BY name');
  return r.rows.map((x) => x.name);
}

/** Decrypted value of one secret, or undefined. For server code only. */
export async function getSecret(name: string): Promise<string | undefined> {
  const p = db();
  if (!p) return undefined;
  await ensureTable(p);
  const r = await p.query<{ value_encrypted: string }>('SELECT value_encrypted FROM app_secrets WHERE name = $1', [name]);
  return r.rows[0] ? decrypt(r.rows[0].value_encrypted) : undefined;
}
