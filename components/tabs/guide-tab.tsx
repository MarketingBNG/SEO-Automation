'use client';

// Guide & map: every page of the dashboard by the job it does (click to open), and a one-page guide
// for each role: what to do every day, step by step.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRole } from '@/hooks/use-role';

type Tab = { key: string; label: string; group: string; hint: string };

const FLOW = [
  'Monthly Strategy: the 30-day plan (keywords, blogs, fixes). A manager approves it.',
  'Blogs are written automatically about 2 days before their slot and fact-checked once.',
  'Review: approve or reject in Monthly Strategy or Drafts & Review (48 hours; no answer = approved).',
  'Publish: at the slot on its own, or "Publish now". Approved blogs are not fact-checked again.',
  'Reports show how the blogs and the site do: SEO, AEO, GEO, leads.',
];

const GUIDES: { role: string; who: string; steps: string[] }[] = [
  {
    role: 'Manager',
    who: 'Owns the plan and what goes live.',
    steps: [
      'Every morning open Home: what waits for you and what publishes next.',
      'Monthly Strategy: read the new plan and approve it (or ask for changes).',
      'Blog Calendar: approve or reject each blog within 48 hours. Tax, legal and compliance blogs need the CA/CPA reviewer name.',
      'Need it out today? Press "Publish now" on the calendar row. Need another day? "Reschedule" or "Pause".',
      'Drafts & Review: pick the author, check the cover, edit text in the preview, or upload the edited Word file.',
      'Topics & News: read "Why this matters for USAIndiaCFO" and decide what is worth writing.',
      'Reports (Overall, SEO, AEO, GEO) once a week; Team & Roles to assign tasks or block someone.',
    ],
  },
  {
    role: 'Analyst',
    who: 'Writes, checks and improves the content.',
    steps: [
      'Home: your tasks for today.',
      'Write a blog: pick a keyword and generate a draft (research and fact check run by themselves).',
      'Drafts & Review: read it, fix what is wrong, add images where it says [VISUAL SUGGESTION], save.',
      'Download as Word to share with a reviewer; upload the edited Word file to replace the blog (a new picture above the title replaces the cover).',
      'Check a blog: audit a file or a link and get a rewrite. Refresh a live blog: update an old post.',
      'Topics & News: write a blog or LinkedIn article from a topic marked "Worth writing".',
      'Reports: download what the manager needs.',
    ],
  },
  {
    role: 'Admin',
    who: 'Everything above, plus the setup.',
    steps: [
      'Settings: connections (WordPress, Google, Bing, Zoho), blog rules, AI credits ("Test both keys").',
      'Team & Roles: give each person a role; change what a role can open and do; give one person extra access, always or for some hours.',
      'Activity Log: everything the dashboard did, with errors.',
    ],
  },
  {
    role: 'User',
    who: 'Sees the plan and does assigned tasks.',
    steps: ['Home and Monthly Strategy: the plan and your tasks.', 'Assistant: ask anything about the site or the plan.', 'Mark your tasks done when finished.'],
  },
];

export default function GuideTab({ tabs, groups, onOpen }: { tabs: readonly Tab[]; groups: Record<string, string>; onOpen: (key: string) => void }) {
  const me = useRole();
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>How the dashboard works</CardTitle>
          <CardDescription>From plan to published blog, in five steps.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="ml-5 list-decimal space-y-1 text-sm">
            {FLOW.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dashboard map</CardTitle>
          <CardDescription>Every page, by the job it does. Click a name to open it. Pages your role cannot open are greyed out.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(groups).map(([g, label]) => {
            const items = tabs.filter((t) => t.group === g && t.key !== 'guide');
            if (!items.length) return null;
            return (
              <div key={g} className="rounded-lg border p-3">
                <div className="mb-2 font-semibold">{label}</div>
                <ul className="space-y-1.5 text-sm">
                  {items.map((t) => {
                    const ok = me.sees(t.key);
                    return (
                      <li key={t.key}>
                        <button type="button" disabled={!ok} className={ok ? 'font-medium text-primary underline' : 'font-medium text-muted-foreground'} onClick={() => onOpen(t.key)}>
                          {t.label}
                        </button>
                        <div className="text-xs text-muted-foreground">{t.hint}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Guide by role</CardTitle>
          <CardDescription>What each person does, in order. You are signed in as {me.role}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {GUIDES.map((g) => (
            <div key={g.role} className={`rounded-lg border p-3 ${g.role.toLowerCase() === me.role ? 'border-primary' : ''}`}>
              <div className="font-semibold">{g.role}</div>
              <div className="mb-2 text-xs text-muted-foreground">{g.who}</div>
              <ol className="ml-5 list-decimal space-y-1 text-sm">
                {g.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
