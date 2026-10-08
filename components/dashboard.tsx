'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  Activity, BarChart3, Bot, BrainCircuit, CalendarRange, FileSearch, FileText, Globe, House, KeyRound,
  LogOut, MessageSquareQuote, RefreshCcw, RefreshCw, Search, Settings, ShieldCheck, Sparkles, Users,
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from '@/components/ui/sidebar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/theme-toggle';
import { JobProgress } from '@/components/shared/job-progress';
import { PeekingOctopus } from '@/components/shared/peeking-octopus';
import { StatusLight } from '@/components/shared/status-light';

import HomeTab from '@/components/tabs/home-tab';
import AssistantTab from '@/components/tabs/assistant-tab';
import KeywordsTab from '@/components/tabs/keywords-tab';
import DraftsTab from '@/components/tabs/drafts-tab';
import AuditTab from '@/components/tabs/audit-tab';
import RenewalTab from '@/components/tabs/renewal-tab';
import PerformanceTab from '@/components/tabs/performance-tab';
import StrategyTab from '@/components/tabs/strategy-tab';
import TrainingTab from '@/components/tabs/training-tab';
import MeetingsTab from '@/components/tabs/meetings-tab';
import ActivityTab from '@/components/tabs/activity-tab';
import SettingsTab from '@/components/tabs/settings-tab';
import TeamTab from '@/components/tabs/team-tab';
import { useRole } from '@/hooks/use-role';
import type { Role } from '@/lib/permissions';

// The pages, grouped by the job they do. Keys are unchanged, so old links (/?tab=drafts) still work.
const TABS = [
  { key: 'home', label: 'Home', icon: House, group: 'Start', hint: 'What waits for you, what publishes next' },
  { key: 'assistant', label: 'Assistant', icon: Bot, group: 'Start', hint: 'Ask anything, change the website' },
  { key: 'strategy', label: 'Monthly Strategy', icon: CalendarRange, group: 'Blogs', hint: 'The 30-day plan, the blog calendar and approvals' },
  { key: 'drafts', label: 'Drafts & Review', icon: FileText, group: 'Blogs', hint: 'Read, edit, add images, approve, download as Word' },
  { key: 'keywords', label: 'Write a blog', icon: KeyRound, group: 'Blogs', hint: 'Keywords: research them and write a blog for one' },
  { key: 'audit', label: 'Check a blog', icon: FileSearch, group: 'Blogs', hint: 'Blog audit: check and rewrite a blog from a file or a link' },
  { key: 'renewal', label: 'Refresh a live blog', icon: RefreshCcw, group: 'Blogs', hint: 'Blog renewal: rewrite an old post on the website' },
  { key: 'overall', label: 'Overall Report', icon: BarChart3, group: 'Reports', hint: 'All channels, month on month' },
  { key: 'seo', label: 'SEO', icon: Search, group: 'Reports', hint: 'Google rankings and clicks' },
  { key: 'aeo', label: 'AEO', icon: MessageSquareQuote, group: 'Reports', hint: 'Answer engines' },
  { key: 'geo', label: 'GEO', icon: Globe, group: 'Reports', hint: 'AI search visibility' },
  { key: 'training', label: 'Writing rules', icon: BrainCircuit, group: 'Workspace', hint: 'Training: the writing guidelines the blogs follow' },
  { key: 'meetings', label: 'Meeting insights', icon: Users, group: 'Workspace', hint: 'What clients said in meetings, for blog ideas' },
  { key: 'activity', label: 'Activity Log', icon: Activity, group: 'Workspace', hint: 'Everything the dashboard did, with errors' },
  { key: 'team', label: 'Team', icon: ShieldCheck, group: 'Workspace', hint: '' },
  { key: 'settings', label: 'Settings', icon: Settings, group: 'Workspace', hint: 'Connections, blog rules, SE Ranking, AI credits' },
] as const;

// Pages each role sees. Users only see the strategy and the assistant; the team page is for admins
// and managers. (The server enforces the same rules on every action.)
const HIDDEN: Record<Role, string[]> = {
  admin: [],
  manager: [],
  analyst: ['team'],
  tester: ['team'],
  user: ['keywords', 'drafts', 'audit', 'renewal', 'overall', 'seo', 'aeo', 'geo', 'training', 'meetings', 'activity', 'team', 'settings'],
};

type TabKey = (typeof TABS)[number]['key'];
const GROUPS = ['Start', 'Blogs', 'Reports', 'Workspace'] as const;
const PERFORMANCE_VIEWS: string[] = ['overall', 'seo', 'aeo', 'geo'];
const isTab = (v: string | null): v is TabKey => !!v && TABS.some((t) => t.key === v);

export default function Dashboard() {
  const params = useSearchParams();
  const { data: session } = useSession();
  const initial = params.get('tab');
  const [tab, setTabState] = useState<TabKey>(isTab(initial) ? initial : 'home');
  const [askText, setAskText] = useState('');
  // Bumped by the Refresh button: the open tab is mounted again, so it loads fresh data.
  const [reloadKey, setReloadKey] = useState(0);
  const [assistantSeed, setAssistantSeed] = useState<{ text: string; nonce: number } | null>(null);
  // A page mounts on first visit and then stays mounted (hidden), so coming back is instant and a
  // running generation keeps its progress and Stop button while you look at another page.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([isTab(initial) ? initial : 'home']));

  // Links such as /?tab=drafts from inside a page switch the open page too.
  const paramTab = params.get('tab');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isTab(paramTab) && paramTab !== tab) setTabState(paramTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramTab]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab]);

  function setTab(next: string) {
    if (!isTab(next)) return;
    setTabState(next);
    // A plain history update: no server round trip for a sidebar click (useSearchParams stays in sync).
    window.history.replaceState(null, '', `/?tab=${next}`);
  }

  function askAssistant(e: FormEvent) {
    e.preventDefault();
    const text = askText.trim();
    if (!text) return;
    setAskText('');
    setTab('assistant');
    setAssistantSeed({ text, nonce: Date.now() });
  }

  const who = useRole();
  const visible = (key: string) => !HIDDEN[who.role].includes(key);
  // A page the role cannot see (for example from an old link) falls back to Home.
  const shown: TabKey = who.loaded && !visible(tab) ? 'home' : tab;
  const current = TABS.find((t) => t.key === shown)!;

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon-512.png" alt="USAIndiaCFO" className="size-8 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-semibold">Growth Center</span>
              <span className="truncate text-xs text-muted-foreground">SEO &amp; Content Automation</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          {GROUPS.map((g) => (
            <SidebarGroup key={g}>
              <SidebarGroupLabel>{g}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {TABS.filter((t) => t.group === g && visible(t.key)).map((t) => (
                    <SidebarMenuItem key={t.key}>
                      <SidebarMenuButton isActive={shown === t.key} tooltip={t.hint ? `${t.label}: ${t.hint}` : t.label} title={t.hint || undefined} onClick={() => setTab(t.key)}>
                        <t.icon />
                        <span>{t.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-2 px-1 group-data-[collapsible=icon]:hidden">
            <div className="min-w-0 flex-1 text-xs">
              <div className="truncate font-medium">{session?.user?.name}</div>
              <div className="truncate text-muted-foreground">{session?.user?.email}</div>
            </div>
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => signOut({ callbackUrl: '/login' })}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <h1 className="hidden shrink-0 text-sm font-semibold sm:block">{current.label}</h1>
          <form onSubmit={askAssistant} className="ml-auto flex w-full max-w-xl items-center gap-2 sm:ml-4">
            <div className="relative w-full">
              <Sparkles className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                placeholder="Ask anything, or tell the assistant what to change on the website"
                aria-label="Ask the assistant"
                className="pl-8"
              />
            </div>
          </form>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-label="Refresh this page"
            title="Load the latest data on this page"
            onClick={() => (tab === 'assistant' ? window.location.reload() : setReloadKey((k) => k + 1))}
          >
            <RefreshCw className="size-4" />
            <span className="hidden md:inline">Refresh</span>
          </Button>
          <StatusLight />
          <ThemeToggle />
        </header>
        {/* Strategy and blog progress, visible from every tab. */}
        <JobProgress key={`jobs-${reloadKey}`} onOpen={(kind) => setTab(kind === 'settings' ? 'settings' : kind === 'blog' ? 'keywords' : 'strategy')} />

        <main className="min-w-0 flex-1 p-3 sm:p-6">
          {who.blocked && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm font-medium">
              Your account is blocked from taking actions. You can still look around. Ask an admin or your manager to unblock you.
            </div>
          )}
          {/* Kept mounted (just hidden) so a running conversation keeps streaming while you look at other tabs. */}
          <div className={shown === 'assistant' ? 'block' : 'hidden'}>
            <AssistantTab seed={assistantSeed} />
          </div>
          {/* Everything except the Assistant reloads when Refresh is pressed. Visited pages stay
              mounted but hidden, so switching back shows them at once. */}
          <div key={`tabs-${reloadKey}`} className="contents">
          {[...visited].filter((k) => k !== 'assistant' && visible(k)).map((k) => (
            <div key={k} className={shown === k ? 'block' : 'hidden'}>
              {k === 'home' && <HomeTab />}
              {k === 'keywords' && <KeywordsTab />}
              {k === 'drafts' && <DraftsTab />}
              {k === 'audit' && <AuditTab />}
              {k === 'renewal' && <RenewalTab />}
              {k === 'strategy' && <StrategyTab active={shown === 'strategy'} />}
              {PERFORMANCE_VIEWS.includes(k) && <PerformanceTab view={k as 'overall' | 'seo' | 'aeo' | 'geo'} onOpen={setTab} />}
              {k === 'training' && <TrainingTab />}
              {k === 'meetings' && <MeetingsTab />}
              {k === 'activity' && <ActivityTab />}
              {k === 'settings' && <SettingsTab />}
              {k === 'team' && <TeamTab />}
            </div>
          ))}
          </div>
        </main>
      </SidebarInset>
      {/* The assistant's octopus peeks in from a screen edge now and then, on every page. */}
      <PeekingOctopus onClick={() => setTab('assistant')} />
    </SidebarProvider>
  );
}
