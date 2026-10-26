import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth';
import { importSpreadsheet, learningTick } from '@/lib/learning';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// The learning library spreadsheet (.xlsx or .csv with a "YouTube Link" or "Video ID" column).
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    const r = await importSpreadsheet(Buffer.from(await file.arrayBuffer()), await getActor());
    if (r.added || r.requeued) void learningTick().catch(() => {});
    return NextResponse.json(r);
  } catch (e: any) {
    if (!e.status) console.error(e);
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
