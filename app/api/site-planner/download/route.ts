import { NextResponse } from 'next/server';
import * as settings from '@/lib/settings';
import { getMe } from '@/lib/auth';
import { htmlToDocx } from '@/lib/docx';
import { planHtml, plannerOpen } from '@/lib/sitePlanner';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// GET: the plan as a Word file.
export async function GET() {
  const me = await getMe();
  if (me?.role !== 'admin') return NextResponse.json({ error: 'Only the admin can use the Website Planner.' }, { status: 403 });
  if (!plannerOpen()) return NextResponse.json({ error: 'The Website Planner is closed.' }, { status: 410 });
  const raw = await settings.get('site_plan');
  if (!raw) return NextResponse.json({ error: 'No plan yet.' }, { status: 404 });
  const buffer = await htmlToDocx(planHtml(JSON.parse(raw)), { title: 'New website plan', margins: { top: 720, bottom: 720, left: 900, right: 900 } });
  return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="usaindiacfo-new-website-plan.docx"' } });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
