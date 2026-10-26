import { NextResponse } from 'next/server';
import { testGemini } from '@/lib/gemini';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Checks the Gemini key and whether the configured model (GEMINI_MODEL) is available to it.
export async function POST() {
  return NextResponse.json(await testGemini());
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
