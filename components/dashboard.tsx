'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  Activity, BarChart3, Bot, BrainCircuit, CalendarRange, FileSearch, FileText, Globe, KeyRound,
  LogOut, MessageSquareQuote, RefreshCcw, RefreshCw, Search, Settings, Sparkles, Users,
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

// Same 14 tabs, same order and keys as the original dashboard.
const TABS = [
  { key: 'assistant', label: 'Assistant', icon: Bot, group: 'Content' },
  { key: 'keywords', label: 'Keywords', icon: KeyRound, group: 'Content' },
  { key: 'drafts', label: 'Drafts & Review', icon: FileText, group: 'Content' },
  { key: 'audit', label: 'Blog Audit', icon: FileSearch, group: 'Content' },
  { key: 'renewal', label: 'Blog Renewal', icon: RefreshCcw, group: 'Content' },
  { key: 'overall', label: 'Overall Report', icon: BarChart3, group: 'Performance' },
  { key: 'seo', label: 'SEO', icon: Search, group: 'Performance' },
  { key: 'aeo', label: 'AEO', icon: MessageSquareQuote, group: 'Performance' },
  { key: 'geo', label: 'GEO', icon: Globe, group: 'Performance' },
  { key: 'strategy', label: 'Monthly Strategy', icon: CalendarRange, group: 'Performance' },
  { key: 'training', label: 'Training', icon: BrainCircuit, group: 'Workspace' },
  { key: 'meetings', label: 'Meetings', icon: Users, group: 'Workspace' },
  { key: 'activity', label: 'Activity Log', icon: Activity, group: 'Workspace' },
  { key: 'settings', label: 'Settings', icon: Settings, group: 'Workspace' },
] as const;

type TabKey = (typeof TABS)[number]['key'];
const GROUPS = ['Content', 'Performance', 'Workspace'] as const;
const PERFORMANCE_VIEWS: string[] = ['overall', 'seo', 'aeo', 'geo'];
const isTab = (v: string | null): v is TabKey => !!v && TABS.some((t) => t.key === v);

export default function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session } = useSession();
  const initial = params.get('tab');
  const [tab, setTabState] = useState<TabKey>(isTab(initial) ? initial : 'assistant');
  const [askText, setAskText] = useState('');
  // Bumped by the Refresh button: the open tab is mounted again, so it loads fresh data.
  const [reloadKey, setReloadKey] = useState(0);
  const [assistantSeed, setAssistantSeed] = useState<{ text: string; nonce: number } | null>(null);
  // The strategy tab mounts on first visit and then stays mounted, so a running generation keeps
  // its progress and Stop button when you look at another tab.
  const [strategyVisited, setStrategyVisited] = useState(initial === 'strategy');

  function setTab(next: string) {
    if (!isTab(next)) return;
    setTabState(next);
    if (next === 'strategy') setStrategyVisited(true);
    router.replace(`/?tab=${next}`, { scroll: false });
  }

  function askAssistant(e: FormEvent) {
    e.preventDefault();
    const text = askText.trim();
    if (!text) return;
    setAskText('');
    setTab('assistant');
    setAssistantSeed({ text, nonce: Date.now() });
  }

  const current = TABS.find((t) => t.key === tab)!;

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
                  {TABS.filter((t) => t.group === g).map((t) => (
                    <SidebarMenuItem key={t.key}>
                      <SidebarMenuButton isActive={tab === t.key} tooltip={t.label} onClick={() => setTab(t.key)}>
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
          <ThemeToggle />
        </header>
        {/* Strategy and blog progress, visible from every tab. */}
        <JobProgress key={`jobs-${reloadKey}`} onOpen={(kind) => setTab(kind === 'strategy' ? 'strategy' : kind === 'settings' ? 'settings' : 'keywords')} />

        <main className="min-w-0 flex-1 p-3 sm:p-6">
          {/* Kept mounted (just hidden) so a running conversation keeps streaming while you look at other tabs. */}
          <div className={tab === 'assistant' ? 'block' : 'hidden'}>
            <AssistantTab seed={assistantSeed} />
          </div>
          {/* Everything except the Assistant reloads when Refresh is pressed. */}
          <div key={`tabs-${reloadKey}`} className="contents">
          {tab === 'keywords' && <KeywordsTab />}
          {tab === 'drafts' && <DraftsTab />}
          {tab === 'audit' && <AuditTab />}
          {tab === 'renewal' && <RenewalTab />}
          {(strategyVisited || tab === 'strategy') && (
            <div className={tab === 'strategy' ? 'block' : 'hidden'}>
              <StrategyTab active={tab === 'strategy'} />
            </div>
          )}
          {PERFORMANCE_VIEWS.includes(tab) && (
            <PerformanceTab key={tab} view={tab as 'overall' | 'seo' | 'aeo' | 'geo'} onOpen={setTab} />
          )}
          {tab === 'training' && <TrainingTab />}
          {tab === 'meetings' && <MeetingsTab />}
          {tab === 'activity' && <ActivityTab />}
          {tab === 'settings' && <SettingsTab />}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
