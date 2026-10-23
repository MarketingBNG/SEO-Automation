import { Badge } from '@/components/ui/badge';
import type { Status } from '@/lib/mock';

const STYLE: Record<Status, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  scheduled: 'bg-blue-100 text-blue-800',
  published: 'bg-indigo-100 text-indigo-800',
  draft: 'bg-slate-100 text-slate-700',
};

export function StatusBadge({ status }: { status: Status }) {
  return <Badge className={`${STYLE[status]} capitalize`}>{status}</Badge>;
}
