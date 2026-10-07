'use client';

// Business results first: organic leads, consults and signed clients by blog topic and service,
// from Zoho CRM. Shows how to switch on page tracking when Zoho has no source fields yet.
import { useEffect, useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataTable, TD, TD_MUTED } from '@/components/shared/content-ui';

const money = (n: number) => (n ? `$${Math.round(n).toLocaleString('en-US')}` : '-');

export function BusinessResults({ days }: { days: number }) {
  const [d, setD] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setD(null);
    fetch(`/api/zoho/business?days=${Math.max(days, 30)}`)
      .then((r) => r.json())
      .then((j) => alive && setD(j))
      .catch((e) => alive && setD({ error: e.message }));
    return () => {
      alive = false;
    };
  }, [days]);

  const setup = d && (d.setupNeeded || d.error) && (
    <details className="rounded-lg border p-3 text-sm" open={Boolean(d.setupNeeded)}>
      <summary className="cursor-pointer font-medium">How to record which page each lead came from (one-time, about 15 minutes)</summary>
      <ol className="mt-2 ml-5 list-decimal space-y-1">
        <li>In Zoho CRM, Setup &gt; Modules and Fields &gt; Leads: add single-line fields named <strong>Landing Page</strong>, <strong>Lead Page</strong>, <strong>UTM Source</strong>, <strong>UTM Medium</strong>, <strong>UTM Campaign</strong> and <strong>UTM Content</strong>. Add the same fields to Deals and map them in Lead Conversion Mapping.</li>
        <li>In each website form (Zoho web form or the WordPress form plugin), add hidden fields with the names landing_page, lead_page, utm_source, utm_medium, utm_campaign and utm_content, mapped to those Zoho fields.</li>
        <li>In WordPress, install the free &quot;WPCode&quot; plugin, add a new &quot;HTML snippet&quot; set to &quot;Site wide footer&quot;, paste the code below and activate it. It fills the hidden fields, passes the tags to Calendly and adds the page to WhatsApp messages.</li>
        <li>In Calendly, Integrations &gt; Zoho CRM: turn on &quot;UTM parameters&quot; so the tags reach the lead.</li>
        <li>Check: open a blog with <code>?utm_source=test</code> at the end, submit the form, and the new lead in Zoho shows the page.</li>
      </ol>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(d.snippet).then(() => setCopied(true)).catch(() => {})}>
          <Copy /> {copied ? 'Copied' : 'Copy the website code'}
        </Button>
        <span className="text-xs text-muted-foreground">Blog calls to action already carry UTM tags automatically.</span>
      </div>
    </details>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business results from content</CardTitle>
        <CardDescription>Organic leads, consults and signed clients from Zoho CRM, by blog topic and service (last {Math.max(days, 30)} days). A consult is a lead whose status shows a call or meeting, or a lead converted to a deal; signed is a deal in a won stage.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!d && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Reading Zoho...</div>}
        {d?.error && <div className="text-muted-foreground">Zoho could not be read: {d.error}</div>}
        {d && !d.error && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ['Organic leads', d.totals.leads],
                ['Consults', d.totals.consults],
                ['Signed clients', d.totals.signed],
                ['Signed value', money(d.totals.value)],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-lg border p-3">
                  <div className="text-muted-foreground">{k}</div>
                  <div className="text-lg font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              {d.trackedShare}% of these have the source page recorded.{' '}
              {d.trackingFields.leads.length ? `Zoho fields used: ${[...new Set([...d.trackingFields.leads, ...d.trackingFields.deals])].join(', ')}.` : 'Zoho has no page or UTM fields yet.'}
            </div>
            {d.services.length > 0 && (
              <DataTable head={['Service', 'Leads', 'Consults', 'Signed', 'Value']}>
                {d.services.map((s: any) => (
                  <tr key={s.service}><td className={TD}>{s.service}</td><td className={TD_MUTED}>{s.leads}</td><td className={TD_MUTED}>{s.consults}</td><td className={TD}>{s.signed}</td><td className={TD_MUTED}>{money(s.value)}</td></tr>
                ))}
              </DataTable>
            )}
            {d.topics.length > 0 && (
              <DataTable head={['Blog topic', 'Service', 'Leads', 'Consults', 'Signed']}>
                {d.topics.slice(0, 25).map((t: any) => (
                  <tr key={t.url || t.title}>
                    <td className={TD}>{t.url ? <a className="underline" href={t.url} target="_blank" rel="noreferrer">{t.title}</a> : t.title}</td>
                    <td className={TD_MUTED}>{t.service}</td>
                    <td className={TD_MUTED}>{t.leads}</td>
                    <td className={TD_MUTED}>{t.consults}</td>
                    <td className={TD}>{t.signed}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </>
        )}
        {setup}
      </CardContent>
    </Card>
  );
}
