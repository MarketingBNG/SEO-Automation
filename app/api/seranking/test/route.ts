import { NextResponse } from 'next/server';
import { getSubscription, listSites } from '@/lib/seranking';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler() {
  try {
    const [subscription, sites]: any[] = await Promise.all([getSubscription(), listSites()]);
    return NextResponse.json(
      {
        ok: true,
        status: subscription.status,
        unitsLeft: subscription.units_left,
        unitsLimit: subscription.units_limit,
        sites: sites.map((s: any) => ({ id: s.id, title: s.title, keywordCount: s.keyword_count })),
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
