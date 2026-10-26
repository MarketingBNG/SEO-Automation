import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// ?slug=<skill>: the active skill; &history=1 adds the earlier versions (without their text).
export async function GET(req: NextRequest) {
  const slug = String(req.nextUrl.searchParams.get('slug') || '');
  const skill = await prisma.creative_skills.findFirst({ where: { slug, status: 'active' }, orderBy: { id: 'desc' } });
  if (!skill) return NextResponse.json({ error: 'No skill built yet for this category.' }, { status: 404 });
  const history = req.nextUrl.searchParams.get('history')
    ? await prisma.creative_skills.findMany({ where: { slug }, orderBy: { id: 'desc' }, select: { id: true, version: true, status: true, created_at: true, built_by: true } })
    : undefined;
  return NextResponse.json({ ...skill, sources: JSON.parse(skill.sources || '[]'), history });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
