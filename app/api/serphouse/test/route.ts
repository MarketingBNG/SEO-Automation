import { NextResponse } from 'next/server';
import { accountInfo } from '@/lib/serphouse';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function GET() {
  try {
    // Quick key check (seconds). The live SERP search can take over a minute, so it is not used here.
    const account = await accountInfo();
    return NextResponse.json({ ok: true, account }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 200 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
