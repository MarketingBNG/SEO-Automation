import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { sqlNow } from '@/lib/time';
import { getActor } from '@/lib/auth';
import { startPalette, refinePalette, type Brief } from '@/lib/brandPalette';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// GET: the palettes made so far; ?id= one palette with its brief and directions.
export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (id) {
    const p = await prisma.brand_palettes.findUnique({ where: { id } });
    if (!p) return NextResponse.json({ error: 'Palette not found' }, { status: 404 });
    return NextResponse.json({ ...p, brief: JSON.parse(p.brief), result: p.result ? JSON.parse(p.result) : null });
  }
  const rows = await prisma.brand_palettes.findMany({ orderBy: { id: 'desc' }, take: 50, select: { id: true, name: true, status: true, error: true, chosen: true, parent_id: true, created_by: true, created_at: true } });
  return NextResponse.json({ palettes: rows });
}

// { action: 'generate', brief } | { action: 'refine', id, index, feedback } | { action: 'choose', id, index } | { action: 'delete', id }
export async function POST(req: NextRequest) {
  const b: any = (await req.json().catch(() => ({}))) || {};
  const actor = await getActor();
  try {
    if (b.action === 'generate') {
      const brief: Brief = Object.fromEntries(Object.entries(b.brief || {}).map(([k, v]) => [k, String(v ?? '').slice(0, 1500)])) as any;
      const row = await startPalette(brief, actor);
      return NextResponse.json({ id: row.id, note: 'Making the palette. It shows in the progress bar at the top; in Testing mode it waits for Claude Code ("run the SEO AI queue").' }, { status: 202 });
    }
    if (b.action === 'refine') {
      const row = await refinePalette(Number(b.id), Number(b.index), String(b.feedback || '').slice(0, 1500), actor);
      return NextResponse.json({ id: row.id, note: 'Refining. The new version appears in the list when it is ready.' }, { status: 202 });
    }
    if (b.action === 'choose') {
      const id = Number(b.id);
      await prisma.brand_palettes.update({ where: { id }, data: { chosen: Number(b.index), updated_at: sqlNow() } });
      await activity.log('brand.palette_chosen', { entityType: 'brand_palette', entityId: id, details: `Palette #${id}: direction ${Number(b.index) + 1} chosen`, actor });
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'delete') {
      await prisma.brand_palettes.delete({ where: { id: Number(b.id) } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    if (!e.status) console.error(e);
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
