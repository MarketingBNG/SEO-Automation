import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyPartner } from '@/lib/partner';
import { addLinks, learningOverview, learningTick } from '@/lib/learning';
import { skillsOverview, skillContent, skillsForPrompt } from '@/lib/creativeSkills';
import { startPalette, refinePalette, type Brief } from '@/lib/brandPalette';
import { sqlNow } from '@/lib/time';
import * as activity from '@/lib/activity';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// The shared brain for the Social Media dashboard (lib/partner.ts has the signature rules). Body:
// { action, data, nonce }. Only these actions exist; nothing else in this dashboard is reachable.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const v = verifyPartner(req, raw);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 400 });
  }
  const d = body.data || {};
  const actor = d.by ? `${String(d.by).slice(0, 60)} (Social dashboard)` : 'Social dashboard';
  try {
    switch (body.action) {
      case 'ping':
        return NextResponse.json({ ok: true, from: 'seo' });
      case 'learning.overview':
        return NextResponse.json({ ...(await learningOverview()), skills: await skillsOverview() });
      case 'learning.add': {
        const r = await addLinks(String(d.links || ''), d.category ? String(d.category).slice(0, 80) : null, actor);
        if (r.added || r.requeued) void learningTick().catch(() => {});
        return NextResponse.json(r);
      }
      case 'learning.notes': {
        const n = await prisma.learning_videos.findUnique({ where: { id: Number(d.id) }, select: { id: true, title: true, channel: true, url: true, category: true, notes: true, status: true, parts_done: true, parts_total: true, model: true } });
        return n ? NextResponse.json(n) : NextResponse.json({ error: 'Video not found' }, { status: 404 });
      }
      case 'skill.get': {
        const s = await skillContent(String(d.slug || ''));
        return s ? NextResponse.json({ ...s, sources: JSON.parse(s.sources || '[]') }) : NextResponse.json({ error: 'No skill built yet for this category.' }, { status: 404 });
      }
      case 'skills.prompt': {
        const slugs = (Array.isArray(d.slugs) ? d.slugs : []).map(String).slice(0, 12);
        return NextResponse.json({ text: await skillsForPrompt(slugs, Math.min(40000, Number(d.maxChars) || 12000)) });
      }
      case 'palette.list':
        return NextResponse.json({ palettes: await prisma.brand_palettes.findMany({ orderBy: { id: 'desc' }, take: 50, select: { id: true, name: true, status: true, error: true, chosen: true, parent_id: true, created_by: true, created_at: true } }) });
      case 'palette.get': {
        const p = await prisma.brand_palettes.findUnique({ where: { id: Number(d.id) } });
        return p ? NextResponse.json({ ...p, brief: JSON.parse(p.brief), result: p.result ? JSON.parse(p.result) : null }) : NextResponse.json({ error: 'Palette not found' }, { status: 404 });
      }
      case 'palette.generate': {
        const brief: Brief = Object.fromEntries(Object.entries(d.brief || {}).map(([k, val]) => [k, String(val ?? '').slice(0, 1500)])) as any;
        const row = await startPalette(brief, actor);
        return NextResponse.json({ id: row.id, note: 'Making the palette on the SEO dashboard (shared brain).' }, { status: 202 });
      }
      case 'palette.refine': {
        const row = await refinePalette(Number(d.id), Number(d.index), String(d.feedback || '').slice(0, 1500), actor);
        return NextResponse.json({ id: row.id, note: 'Refining.' }, { status: 202 });
      }
      case 'palette.choose': {
        const id = Number(d.id);
        await prisma.brand_palettes.update({ where: { id }, data: { chosen: Number(d.index), updated_at: sqlNow() } });
        await activity.log('brand.palette_chosen', { entityType: 'brand_palette', entityId: id, details: `Palette #${id}: direction ${Number(d.index) + 1} chosen`, actor });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e: any) {
    if (!e.status) console.error(e);
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
