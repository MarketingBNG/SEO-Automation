import { Check, Circle } from 'lucide-react';
import { StatusBadge } from '@/components/shared/status-badge';
import { cn } from 'cn';

// Google's "People also ask" questions for the topic, with whether the FAQ answers each one.
export function PeopleAlsoAskList({ items, label }: { items: any; label?: string }) {
  const list: any[] = typeof items === 'string' ? JSON.parse(items || '[]') : items || [];
  if (!list.length) return null;
  const used = list.filter((q) => q.used).length;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">{label || 'Google "People also ask" questions for this topic'}</div>
        <StatusBadge status={used > 0 ? 'approved' : 'failed'}>
          FAQ answers {used} of {list.length}
        </StatusBadge>
      </div>
      <ul className="mt-2 space-y-1">
        {list.map((q, i) => (
          <li key={i} className={cn('flex items-start gap-2 text-sm', !q.used && 'text-muted-foreground')}>
            <span className="mt-0.5 shrink-0">
              {q.used ? (
                <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-label="✓" />
              ) : (
                <Circle className="size-4" aria-label="○" />
              )}
            </span>
            <span className={cn('flex-1', q.used && 'text-foreground')}>{q.question}</span>
            {q.markets?.length > 0 && <span className="shrink-0 text-xs text-muted-foreground">{q.markets.join(', ')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PeopleAlsoAskList;
