import { NextResponse } from 'next/server';
import { learnLessons } from '@/lib/lessons';
import { methodNotAllowed } from '../_lib/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST: learn from the latest reviews, holds and results now (it also runs every Monday).
export async function POST() {
  try {
    return NextResponse.json(await learnLessons());
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
