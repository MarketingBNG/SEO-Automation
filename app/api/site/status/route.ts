import { NextResponse } from 'next/server';
import { siteConfigured, draftsAllowed, SITE_NOT_SET_UP } from '@/lib/site';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// What the publish screens need to know, without calling the website: whether the website
// connection is set up and whether it keeps drafts hidden (so "website draft" can be offered).
export async function GET() {
  const configured = siteConfigured();
  return NextResponse.json({ configured, draftsAllowed: configured && draftsAllowed(), error: configured ? null : SITE_NOT_SET_UP });
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
