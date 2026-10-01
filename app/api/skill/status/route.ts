import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';

const REFRESH_DAYS = 15;

// Old handler accepted any method.
async function handler() {
  const active: any = await prisma.writing_skills.findFirst({ where: { status: 'active' }, orderBy: { id: 'desc' } });

  if (!active) {
    return NextResponse.json({ hasActive: false, needsUpdate: true, daysSinceUpdate: null }, { status: 200 });
  }

  const ageMs = Date.now() - new Date(active.created_at + 'Z').getTime();
  const daysSinceUpdate = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  return NextResponse.json(
    {
      hasActive: true,
      needsUpdate: daysSinceUpdate >= REFRESH_DAYS,
      daysSinceUpdate,
      refreshDays: REFRESH_DAYS,
      active: { ...active, sources: JSON.parse(active.sources || '[]') },
    },
    { status: 200 }
  );
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
