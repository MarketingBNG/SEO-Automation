'use client';

// One-time "Connect your Zoho" banner for tracked people (everyone except the admin). Once the person
// connects, their daily attendance hours are logged to their team's Zoho project. The admin never
// sees this. The banner sits at the top of the dashboard until Zoho is connected.
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { useRole } from '@/hooks/use-role';

export function ZohoConnect() {
  const { role, loaded } = useRole();
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (!loaded || role === 'admin') return;
    let on = true;
    fetch('/api/zoho-projects/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => on && setConnected(j ? Boolean(j.connected) : null))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [loaded, role]);

  if (role === 'admin' || connected === null || connected === true) return null;

  const justConnected = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('zoho') === 'connected';

  return (
    <div className="mx-auto mb-4 flex max-w-5xl flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <div className="font-medium">Connect your Zoho (one time)</div>
        <div className="text-muted-foreground">
          {justConnected
            ? 'Almost there. If this is still showing, click Connect once more.'
            : 'This lets your work hours go to your Zoho timesheet automatically. You only do this once.'}
        </div>
      </div>
      <a href="/api/zoho-projects/auth-url" className={`${buttonVariants()} shrink-0`}>Connect Zoho</a>
    </div>
  );
}
