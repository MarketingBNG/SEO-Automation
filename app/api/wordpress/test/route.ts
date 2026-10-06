import { NextResponse } from 'next/server';
import { testConnection } from '@/lib/wordpress';

export const runtime = 'nodejs';

// Old handler accepted any method.
async function handler() {
  try {
    const user: any = await testConnection();
    const roles: string[] = Array.isArray(user.roles) ? user.roles : [];
    const caps = user.capabilities || {};
    return NextResponse.json(
      {
        ok: true,
        connectedAs: user.name,
        roles,
        isAdministrator: roles.includes('administrator'),
        // What the automatic fixes need: plugins (Redirection, Cache Enabler), media uploads, page edits.
        canInstallPlugins: Boolean(caps.install_plugins && caps.activate_plugins),
        canUploadMedia: Boolean(caps.upload_files),
        canEditPages: Boolean(caps.edit_others_posts && caps.edit_pages),
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
