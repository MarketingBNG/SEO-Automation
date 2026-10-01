import type { ComponentProps, ReactNode } from 'react';
import { cn } from 'cn';

// Small presentational helpers shared by the Assistant / Keywords / Drafts tabs.

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      {...props}
      className={cn(
        'h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30',
        className,
      )}
    />
  );
}

export function DataTable({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border', className)}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>{head.map((h, i) => <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y [&>tr:hover]:bg-muted/30">{children}</tbody>
      </table>
    </div>
  );
}

export const TD = 'px-3 py-2 align-top';
export const TD_MUTED = 'px-3 py-2 align-top text-muted-foreground';

export function Banner({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm', className)}>{children}</div>;
}

export function SubBox({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border bg-muted/20 p-4', className)}>{children}</div>;
}

export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cn('mb-1 block text-xs font-medium text-muted-foreground', className)}>{children}</label>;
}
