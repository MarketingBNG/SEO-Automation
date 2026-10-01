import type { ReactNode } from 'react';
import { cn } from 'cn';

// Maps the old `badge <status>` colour classes to theme-aware Tailwind classes.
const TONES: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground border-border',
  generating: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',
  drafted: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
  pending_review: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
  approved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  published: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-500/40',
  rejected: 'bg-destructive/10 text-destructive border-destructive/30',
  failed: 'bg-destructive/10 text-destructive border-destructive/30',
  gold: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
};

export function toneClass(status: any) {
  return TONES[String(status)] || TONES.pending;
}

export function StatusBadge({
  status,
  children,
  className,
  title,
}: {
  status: any;
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap',
        toneClass(status),
        className,
      )}
    >
      {children ?? status}
    </span>
  );
}
