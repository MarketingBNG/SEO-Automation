import { NextResponse } from 'next/server';
import { getSkillText } from '@/lib/playbook';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ text: await getSkillText() }, { status: 200 });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
