import { NextResponse } from 'next/server';
import { startLessons } from '@/lib/writingRules';
import { startedAt } from '@/lib/jobTimer';
import * as settings from '@/lib/settings';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';

// POST: learns from the latest reviews, holds and results in the background (it also runs every
// Monday). GET returns whether it is running and the current lessons.
export async function POST() {
  return NextResponse.json(await startLessons());
}

export async function GET() {
  return NextResponse.json({ running: Boolean(startedAt('lessons')), lessons: (await settings.get('writer_lessons')) || '' });
}
export { methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
