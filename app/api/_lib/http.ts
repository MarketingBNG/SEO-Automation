import { NextResponse } from 'next/server';

// The old pages/api handlers answered unsupported methods with this exact JSON body. Route files
// export it for every method they don't support so the 405 response stays identical.
export async function methodNotAllowed() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

// SQLite compared `id = ?` loosely; a non-numeric id simply matched nothing. Prisma needs an Int,
// so anything that isn't a whole number maps to an id that can never exist (-> same 404 path).
export function toId(v: unknown): number {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : -1;
}

export function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Vercel Cron can only send GET requests, with `Authorization: Bearer <CRON_SECRET>`. Routes whose
// scheduled action used to be a POST run it on GET only for these requests; every other GET keeps
// its old behaviour.
export function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}
