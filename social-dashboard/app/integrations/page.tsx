import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shell';
import { GROUP_LABELS, integrations, isConnected, type Integration } from '@/lib/integrations';
import { listSecretNames } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

export default async function Integrations() {
  const stored = new Set(await listSecretNames().catch(() => []));
  const groups = Object.keys(GROUP_LABELS) as Integration['group'][];
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect one by one, top to bottom. Keys are stored encrypted in this dashboard's own database (never in code). 'Shared' keys are the same values as the SEO dashboard."
      />
      <div className="space-y-6">
        {groups.map((g) => (
          <Card key={g}>
            <CardHeader><CardTitle>{GROUP_LABELS[g]}</CardTitle></CardHeader>
            <CardContent className="divide-y">
              {integrations.filter((i) => i.group === g).map((i) => {
                const on = isConnected(i, stored);
                return (
                  <div key={i.name} className="grid gap-2 py-3 text-sm md:grid-cols-[1.3fr_1.6fr_1fr_auto] md:items-center">
                    <div>
                      <div className="font-medium">{i.name}</div>
                      <div className="text-xs text-muted-foreground">{i.purpose}</div>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">{i.envKeys.join(', ')}</div>
                    <div className="text-xs">
                      {i.cost}
                      <div className="space-x-2">
                        <a className="text-primary underline" href={i.signup} target="_blank" rel="noreferrer">Get key</a>
                        <a className="text-primary underline" href={i.docs} target="_blank" rel="noreferrer">Docs</a>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {i.shared && <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] text-blue-800">Shared</span>}
                      <span className={`rounded px-2 py-0.5 text-[10px] ${on ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{on ? 'Connected' : 'Not connected'}</span>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
