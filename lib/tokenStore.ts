import prisma from './prisma';
import { sqlNow } from './time';

// Replaces secrets/<provider>-tokens.json. Stores the exact same JSON object the file held.

export async function readTokens<T = Record<string, unknown>>(provider: string): Promise<T | null> {
  const row = await prisma.oauth_tokens.findUnique({ where: { provider } });
  return row ? (JSON.parse(row.data) as T) : null;
}

export async function writeTokens(provider: string, tokens: unknown): Promise<void> {
  const data = JSON.stringify(tokens, null, 2);
  await prisma.oauth_tokens.upsert({
    where: { provider },
    create: { provider, data },
    update: { data, updated_at: sqlNow() },
  });
}

export async function hasTokens(provider: string): Promise<boolean> {
  return (await prisma.oauth_tokens.count({ where: { provider } })) > 0;
}
