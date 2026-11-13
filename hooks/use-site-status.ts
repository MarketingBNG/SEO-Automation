'use client';

// Whether the website connection is set up and keeps drafts hidden (GET /api/site/status), read once
// per page load. Until it answers, drafts are not offered.
import { useEffect, useState } from 'react';

export type SiteStatus = { configured: boolean; draftsAllowed: boolean; error: string | null };
const UNKNOWN: SiteStatus = { configured: true, draftsAllowed: false, error: null };
let cached: Promise<SiteStatus> | null = null;

export function useSiteStatus(): SiteStatus {
  const [status, setStatus] = useState<SiteStatus>(UNKNOWN);
  useEffect(() => {
    let alive = true;
    cached ||= fetch('/api/site/status')
      .then((r) => (r.ok ? r.json() : UNKNOWN))
      .catch(() => {
        cached = null;
        return UNKNOWN;
      });
    cached.then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, []);
  return status;
}
