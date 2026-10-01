import { NextResponse } from 'next/server';
import { testConnection } from '@/lib/wordpress';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler() {
  try {
    const user: any = await testConnection();
    return NextResponse.json({ ok: true, connectedAs: user.name }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
