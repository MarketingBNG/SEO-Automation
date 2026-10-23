import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Links to sibling dashboards (set in the environment, e.g. Coolify). Used by the header to show a
// "Social media" button that opens the other dashboard. No link set means no button.
export async function GET() {
  return NextResponse.json({
    social: (process.env.SOCIAL_DASHBOARD_URL || '').trim() || null,
    socialLabel: (process.env.SOCIAL_DASHBOARD_LABEL || 'Social media').trim(),
  });
}
