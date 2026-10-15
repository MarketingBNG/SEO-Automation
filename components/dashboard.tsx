'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  Activity, BarChart3, BookOpen, Bot, BrainCircuit, CalendarClock, CalendarRange, FileSearch, FileText, Globe, GraduationCap, House, PanelsTopLeft, KeyRound, Lightbulb,
  LogOut, MessageSquareQuote, RefreshCcw, RefreshCw, Search, Settings, ShieldCheck, Sparkles, Users,
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInput, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from '@/components/ui/sidebar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/theme-toggle';
import { JobProgress } from '@/components/shared/job-progress';
import { PeekingOctopus } from '@/components/shared/peeking-octopus';
import { StatusLight } from '@/components/shared/status-light';

import HomeTab from '@/components/tabs/home-tab';
import TopicsTab from '@/components/tabs/topics-tab';
import AssistantTab from '@/components/tabs/assistant-tab';
import KeywordsTab from '@/components/tabs/keywords-tab';
import DraftsTab from '@/components/tabs/drafts-tab';
import AuditTab from '@/components/tabs/audit-tab';
import RenewalTab from '@/components/tabs/renewal-tab';
import PerformanceTab from '@/components/tabs/performance-tab';
import StrategyTab, { MonthRunning } from '@/components/tabs/strategy-tab';
import TrainingTab from '@/components/tabs/training-tab';
import AssociateTrainingTab from '@/components/tabs/associate-training-tab';
import WebsiteContentTab from '@/components/tabs/website-content-tab';
import MeetingsTab from '@/components/tabs/meetings-tab';
import ActivityTab from '@/components/tabs/activity-tab';
import SettingsTab from '@/components/tabs/settings-tab';
import TeamTab from '@/components/tabs/team-tab';
import GuideTab from '@/components/tabs/guide-tab';
import { useRole } from '@/hooks/use-role';
import type { Role } from '@/lib/permissions';

// The pages, grouped by the job they do, in the order the work happens. Keys are unchanged, so old
// links (/?tab=drafts) still work.
const TABS = [
  { key: 'home', label: 'Home', icon: House, group: 'Start', hint: 'What waits for you today and what publishes next' },
  { key: 'assistant', label: 'Assistant', icon: Bot, group: 'Start', hint: 'Ask anything, change the website' },
  { key: 'guide', label: 'Guide & map', icon: BookOpen, group: 'Start', hint: 'Every page on one map, and a step-by-step guide for each role' },

  { key: 'strategy', label: 'Monthly Strategy', icon: CalendarRange, group: 'Plan', hint: 'The 30-day plan: keywords, blogs, fixes; approve it here' },
  { key: 'calendar', label: 'Blog Calendar', icon: CalendarClock, group: 'Plan', hint: 'Automatic blogs: approve, reject, pause, reschedule' },
  { key: 'topics', label: 'Topics & News', icon: Lightbulb, group: 'Plan', hint: 'Last 24 hours news and evergreen topics, every morning at 10:00 IST' },

  { key: 'keywords', label: 'Write a blog', icon: KeyRound, group: 'Write', hint: 'Research keywords and write a blog for one' },
  { key: 'drafts', label: 'Drafts & Review', icon: FileText, group: 'Write', hint: 'Read, edit, add images, approve, download as Word' },
  { key: 'audit', label: 'Check a blog', icon: FileSearch, group: 'Write', hint: 'Audit and rewrite a blog from a file or a link' },
  { key: 'renewal', label: 'Refresh a live blog', icon: RefreshCcw, group: 'Write', hint: 'Rewrite an old post on the website' },
  { key: 'training', label: 'Writing rules', icon: BrainCircuit, group: 'Write', hint: 'The guidelines every blog follows' },

  { key: 'sitecontent', label: 'Website Content', icon: PanelsTopLeft, group: 'Website', hint: 'Pages and blog posts of the new website' },

  { key: 'overall', label: 'Overall Report', icon: BarChart3, group: 'Reports', hint: 'All channels, month on month' },
  { key: 'seo', label: 'SEO', icon: Search, group: 'Reports', hint: 'Google rankings and clicks' },
  { key: 'aeo', label: 'AEO', icon: MessageSquareQuote, group: 'Reports', hint: 'Answer engines' },
  { key: 'geo', label: 'GEO', icon: Globe, group: 'Reports', hint: 'AI search visibility' },
  { key: 'meetings', label: 'Meeting insights', icon: Users, group: 'Reports', hint: 'What clients said in meetings' },

  { key: 'associates', label: 'Associate Training', icon: GraduationCap, group: 'Team', hint: 'Daily lesson, next-day test, levels' },
  { key: 'team', label: 'Team & Roles', icon: ShieldCheck, group: 'Team', hint: 'Who can sign in and what they can do' },
  { key: 'activity', label: 'Activity Log', icon: Activity, group: 'Team', hint: 'Everything the dashboard did, with errors' },

  { key: 'settings', label: 'Settings', icon: Settings, group: 'Admin', hint: 'Connections, blog rules, SE Ranking, AI credits' },
] as const;

// Pages each role sees. Users only see the strategy and the assistant; the team page is for admins
// and managers. (The server enforces the same rules on every action.)
const HIDDEN: Record<Role, string[]> = {
  admin: [],
  manager: [],
  analyst: ['team'],
  tester: ['team'],
  user: ['sitecontent', 'keywords', 'topics', 'drafts', 'audit', 'renewal', 'overall', 'seo', 'aeo', 'geo', 'training', 'meetings', 'activity', 'team', 'settings'],
};

type TabKey = (typeof TABS)[number]['key'];
const GROUPS = ['Start', 'Plan', 'Write', 'Website', 'Reports', 'Team', 'Admin'] as const;
const GROUP_LABEL: Record<(typeof GROUPS)[number], string> = {
  Start: 'Start',
  Plan: 'Plan & publish',
  Write: 'Write & edit',
  Website: 'Website',
  Reports: 'Reports',
  Team: 'Team & training',
  Admin: 'Admin',
};
const PERFORMANCE_VIEWS: string[] = ['overall', 'seo', 'aeo', 'geo'];
const isTab = (v: string | null): v is TabKey => !!v && TABS.some((t) => t.key === v);

export default function Dashboard() {
  const params = useSearchParams();
  const { data: session } = useSession();
  const initial = params.get('tab');
  const [tab, setTabState] = useState<TabKey>(isTab(initial) ? initial : 'home');
  const [find, setFind] = useState('');
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
  // Read once when the page loads (the clock is not read during render).
  const visible = (key: string) => (who.loaded ? who.sees(key) : !HIDDEN[who.role].includes(key));
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
          <div className="px-2 pt-1 group-data-[collapsible=icon]:hidden">
            <SidebarInput placeholder="Find a page…" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find a page" />
          </div>
          {GROUPS.map((g) => {
            const q = find.trim().toLowerCase();
            const items = TABS.filter((t) => t.group === g && visible(t.key) && (!q || `${t.label} ${t.hint} ${GROUP_LABEL[g]}`.toLowerCase().includes(q)));
            if (!items.length) return null;
            return (
              <SidebarGroup key={g}>
                <SidebarGroupLabel>{GROUP_LABEL[g]}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {items.map((t) => (
                      <SidebarMenuItem key={t.key}>
                        <SidebarMenuButton isActive={shown === t.key} tooltip={`${t.label}: ${t.hint}`} title={t.hint} onClick={() => setTab(t.key)}>
                          <t.icon />
                          <span>{t.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })}
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-2 px-1 group-data-[collapsible=icon]:hidden">
            <div className="min-w-0 flex-1 text-xs">
              <div className="truncate font-medium">{session?.user?.name}</div>
              <div className="truncate text-muted-foreground">{session?.user?.email}</div>
              {process.env.NEXT_PUBLIC_BUILD_TIME && (
                <div className="truncate text-muted-foreground" title="When this version of the dashboard was built">
                  Version: {new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST
                </div>
              )}
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
        {/* Stays under the header while you scroll, so running work is always in view. */}
        <div className="sticky top-14 z-10">
          <JobProgress key={`jobs-${reloadKey}`} onOpen={(kind) => setTab(kind === 'settings' ? 'settings' : kind === 'blog' ? 'keywords' : kind === 'audit' || kind === 'rewrite' ? 'audit' : kind === 'activity' ? 'activity' : 'strategy')} />
        </div>

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
              {k === 'topics' && <TopicsTab />}
              {k === 'calendar' && <MonthRunning standalone />}
              {k === 'associates' && <AssociateTrainingTab />}
              {k === 'sitecontent' && <WebsiteContentTab />}
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
              {k === 'guide' && <GuideTab tabs={TABS} groups={GROUP_LABEL} onOpen={setTab} />}
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
