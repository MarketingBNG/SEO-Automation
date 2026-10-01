'use client';

// Small widgets shared across tabs (ported 1:1 from pages/index.js; only the look changed).
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { safeHref } from '@/components/shared/article';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// ---- Status badges ---------------------------------------------------------------------------
// The old UI used `badge <kind>` CSS classes. The same kinds map to these theme-aware styles.
const BADGE_STYLES: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground border-border',
  generating: 'bg-orange-500/10 text-orange-600 border-orange-500/30 dark:text-orange-400',
  drafted: 'bg-blue-500/10 text-blue-600 border-blue-500/30 dark:text-blue-400',
  pending_review: 'bg-blue-500/10 text-blue-600 border-blue-500/30 dark:text-blue-400',
  approved: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400',
  published: 'bg-emerald-500/20 text-emerald-800 border-emerald-500/40 dark:text-emerald-300',
  rejected: 'bg-destructive/10 text-destructive border-destructive/30',
  failed: 'bg-destructive/10 text-destructive border-destructive/30',
  gold: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
};

export function badgeClass(kind: string | null | undefined) {
  return BADGE_STYLES[kind || ''] || BADGE_STYLES.pending;
}

/** Equivalent of the old `<span className={`badge ${kind}`}>`. */
export function StatusBadge({ kind, children, className }: { kind: string | null | undefined; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap',
        badgeClass(kind),
        className
      )}
    >
      {children}
    </span>
  );
}

export function statusBadgeClass(status: string) {
  return status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : status === 'superseded' ? 'failed' : 'pending';
}

// ---- Delta -----------------------------------------------------------------------------------
export function Delta({ value, suffix = '%', invert = false }: { value: any; suffix?: string; invert?: boolean }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">n/a</span>;
  const good = invert ? value < 0 : value > 0;
  const cls =
    value === 0
      ? 'text-muted-foreground'
      : good
      ? 'font-semibold text-emerald-600 dark:text-emerald-400'
      : 'font-semibold text-red-600 dark:text-red-400';
  return (
    <span className={cls}>
      {value > 0 ? '+' : ''}
      {value}
      {suffix}
    </span>
  );
}

// ---- ActionMessage ---------------------------------------------------------------------------
export function ActionMessage({ message }: { message: { text: string; link?: string } | null | undefined }) {
  if (!message) return null;
  const href = safeHref(message.link);
  return (
    <p className="text-sm text-muted-foreground">
      {message.text}
      {href && (
        <>
          {' '}
          <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4 break-all">
            {message.link}
          </a>
        </>
      )}
    </p>
  );
}

// ---- Tables ----------------------------------------------------------------------------------
export type Col = { key: string; label: string; muted?: boolean; render?: (row: any) => ReactNode };

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-xs font-medium uppercase tracking-wide text-muted-foreground', className)}>{children}</div>;
}

export function DataTable({ rows, cols }: { rows: any[]; cols: Col[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            {cols.map((c) => (
              <TableHead key={c.key}>{c.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {cols.map((c) => (
                <TableCell key={c.key} className={cn('whitespace-normal', c.muted && 'text-muted-foreground')}>
                  {c.render ? c.render(r) : r[c.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SimpleTable({ title, note, rows, cols, empty }: { title: ReactNode; note?: ReactNode; rows: any[] | null | undefined; cols: Col[]; empty?: ReactNode }) {
  if (!rows || rows.length === 0) {
    return empty ? (
      <div className="mt-4 space-y-1">
        <SectionLabel>{title}</SectionLabel>
        <p className="text-sm text-muted-foreground">{empty}</p>
      </div>
    ) : null;
  }
  return (
    <div className="mt-4 space-y-1.5">
      <SectionLabel>{title}</SectionLabel>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      <DataTable rows={rows} cols={cols} />
    </div>
  );
}

// ---- KPI tile ---------------------------------------------------------------------------------
export function KpiTile({ label, value, children, title }: { label: ReactNode; value: ReactNode; children?: ReactNode; title?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs" title={title}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {children && <div className="mt-1 text-xs">{children}</div>}
    </div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

// ---- Native select (keeps plain <select> value/onChange semantics) ---------------------------
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground',
        className
      )}
      {...props}
    />
  );
}

// ---- Banner (old .due-banner) -----------------------------------------------------------------
export function Banner({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200', className)}>
      {children}
    </div>
  );
}

// ---- People also ask ---------------------------------------------------------------------------
export function PeopleAlsoAskList({ items, label }: { items: any; label?: string }) {
  const list: any[] = typeof items === 'string' ? JSON.parse(items || '[]') : items || [];
  if (!list.length) return null;
  const used = list.filter((q) => q.used).length;
  return (
    <div className="mt-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">{label || 'Google "People also ask" questions for this topic'}</div>
        <StatusBadge kind={used > 0 ? 'approved' : 'failed'}>
          FAQ answers {used} of {list.length}
        </StatusBadge>
      </div>
      <ul className="mt-2 space-y-1">
        {list.map((q, i) => (
          <li key={i} className={cn('flex items-start gap-2 text-sm', !q.used && 'text-muted-foreground')}>
            {q.used ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <Circle className="mt-0.5 size-4 shrink-0" />}
            <span>{q.question}</span>
            {q.markets?.length > 0 && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{q.markets.join(', ')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
