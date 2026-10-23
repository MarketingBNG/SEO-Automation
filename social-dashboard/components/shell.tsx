'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Search, Target, CalendarDays, PenSquare, Upload, Newspaper,
  MessageSquare, FolderOpen, Brain, Plug, ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/research', label: 'Research & Trends', icon: Search },
  { href: '/strategy', label: 'Monthly Strategy', icon: Target },
  { href: '/calendar', label: 'Content Calendar', icon: CalendarDays },
  { href: '/content', label: 'Content Review', icon: PenSquare },
  { href: '/upload', label: 'Upload Studio', icon: Upload },
  { href: '/news', label: '24/7 News', icon: Newspaper },
  { href: '/replies', label: 'Replies', icon: MessageSquare },
  { href: '/assets', label: 'Asset Library', icon: FolderOpen },
  { href: '/learning', label: 'Learning & Skills', icon: Brain },
  { href: '/integrations', label: 'Integrations', icon: Plug },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-60 shrink-0 flex-col bg-[#0B1430] text-white md:flex">
        <div className="border-b border-white/10 px-5 py-4">
          <div className="text-sm font-bold tracking-wide">USAIndiaCFO</div>
          <div className="text-xs text-[#E8B04B]">Social Media Marketing</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? path === '/' : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  active ? 'bg-[#E8B04B] font-medium text-[#0B1430]' : 'text-white/80 hover:bg-white/10',
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <a
          href={process.env.NEXT_PUBLIC_SEO_DASHBOARD_URL ?? 'https://seo.usaindiacfo.us'}
          className="flex items-center gap-2 border-t border-white/10 px-5 py-3 text-xs text-white/70 hover:text-white"
        >
          <ArrowLeft className="size-3.5" /> Back to SEO dashboard
        </a>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <nav className="flex gap-1 overflow-x-auto bg-[#0B1430] p-2 md:hidden">
          {NAV.map(({ href, label }) => (
            <Link key={href} href={href} className="whitespace-nowrap rounded px-2 py-1 text-xs text-white/80">
              {label}
            </Link>
          ))}
        </nav>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-[#1B2A5E] dark:text-white">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
