import { NextResponse } from 'next/server';
import { listWorkspaces } from '@/lib/surfer';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function GET() {
  if (!process.env.SURFER_API_KEY) return NextResponse.json({ ok: false, connected: false, error: 'SURFER_API_KEY is not set.' });
  try {
    const { data }: any = await listWorkspaces();
    return NextResponse.json({ ok: true, workspaces: data.map((w: any) => ({ id: w.id, name: w.name, location: w.location })) }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 200 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
