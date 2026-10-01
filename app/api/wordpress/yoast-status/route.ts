import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { wpRequest } from '@/lib/wordpress';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

// Reports whether the one-time Yoast REST snippet is installed (the Yoast fields appear in a
// post's editable meta), and returns the snippet so the Settings card can offer a copy button.
export async function GET() {
  // PORT NOTE: read from the deployed bundle; next.config should include wordpress/yoast-rest-fields.php
  // in outputFileTracingIncludes for this route so the file exists on Vercel.
  const snippet = fs.readFileSync(path.join(process.cwd(), 'wordpress', 'yoast-rest-fields.php'), 'utf8');
  try {
    const { json }: any = await wpRequest('GET', '/wp/v2/posts', { query: { per_page: 1, context: 'edit', _fields: 'id,meta' } });
    const meta = json[0]?.meta || {};
    return NextResponse.json({ installed: '_yoast_wpseo_metadesc' in meta, snippet }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ installed: false, error: err.message, snippet }, { status: 200 });
  }
}
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };
