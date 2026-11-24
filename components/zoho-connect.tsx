'use client';

// Zoho connection status for tracked people (everyone except the admin). Shows BOTH connections with a
// clear green "Connected" when active, and a "Connect" button when not:
//  - Zoho Projects: the person's daily hours go to their team's Zoho timesheet.
//  - Zoho People: the person's daily attendance Check In (from SEB) is recorded.
// The admin never sees this.
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { useRole } from '@/hooks/use-role';

function Row({ name, connected, href }: { name: string; connected: boolean | null; href: string }) {
  if (connected === null) return null; // still checking
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden />
      <span className="font-medium">{name}</span>
      {connected ? (
        <span className="font-medium text-emerald-600">Connected</span>
      ) : (
        <>
          <span className="text-amber-600">Not connected</span>
          <a href={href} className={`${buttonVariants({ size: 'sm' })} ml-1`}>Connect</a>
        </>
      )}
    </div>
  );
}

export function ZohoConnect() {
  const { role, loaded } = useRole();
  const [projects, setProjects] = useState<boolean | null>(null);
  const [people, setPeople] = useState<boolean | null>(null);

  useEffect(() => {
    if (!loaded || role === 'admin') return;
    let on = true;
    fetch('/api/zoho-projects/status').then((r) => (r.ok ? r.json() : null)).then((j) => on && setProjects(j ? Boolean(j.connected) : null)).catch(() => {});
    fetch('/api/zoho-people/status').then((r) => (r.ok ? r.json() : null)).then((j) => on && setPeople(j ? Boolean(j.connected) : null)).catch(() => {});
    return () => { on = false; };
  }, [loaded, role]);

  if (role === 'admin' || (projects === null && people === null)) return null;

  return (
    <div className="mx-auto mb-4 max-w-5xl rounded-lg border bg-card p-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Zoho connections</div>
      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8">
        <Row name="Zoho People (attendance)" connected={people} href="/api/zoho-people/auth-url" />
        <Row name="Zoho Projects (timesheet)" connected={projects} href="/api/zoho-projects/auth-url" />
      </div>
    </div>
  );
}
