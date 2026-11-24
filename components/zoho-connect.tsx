'use client';

// One-time "Connect your Zoho" banners for tracked people (everyone except the admin). Two things:
//  - Zoho Projects: the person's daily hours go to their team's Zoho timesheet.
//  - Zoho People: the person's daily attendance Check In (from SEB) is recorded.
// Each banner shows until that one is connected. The admin never sees these.
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { useRole } from '@/hooks/use-role';

function Banner({ title, desc, href, label }: { title: string; desc: string; href: string; label: string }) {
  return (
    <div className="mx-auto mb-4 flex max-w-5xl flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <div className="font-medium">{title}</div>
        <div className="text-muted-foreground">{desc}</div>
      </div>
      <a href={href} className={`${buttonVariants()} shrink-0`}>{label}</a>
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

  if (role === 'admin') return null;

  return (
    <>
      {projects === false && (
        <Banner
          title="Connect your Zoho (timesheet)"
          desc="This lets your work hours go to your Zoho timesheet automatically. You only do this once."
          href="/api/zoho-projects/auth-url"
          label="Connect Zoho"
        />
      )}
      {people === false && (
        <Banner
          title="Connect Zoho People (attendance)"
          desc="This records your daily Check In. You only do this once, here in your normal browser."
          href="/api/zoho-people/auth-url"
          label="Connect Zoho People"
        />
      )}
    </>
  );
}
