import { NextResponse } from 'next/server';
import { listAccessibleSites } from '@/lib/searchConsole';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler() {
  try {
    const sites: any[] = await listAccessibleSites();
    if (sites.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Connected to Google, but this service account has no Search Console properties. Add its email as a user in Search Console → Settings → Users and permissions.',
        },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: true, sites: sites.map((s) => ({ url: s.siteUrl, permission: s.permissionLevel })) }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
