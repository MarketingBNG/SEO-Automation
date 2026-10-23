'use client';

import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/status-badge';
import type { Status } from '@/lib/mock';

/**
 * Approve / Edit / Reject with a comment. Used at all three gates (strategy, calendar, final post).
 * A rejection needs a reason: the next version is generated from that comment.
 */
export function ReviewActions({ initial = 'pending', editLabel = 'Edit' }: { initial?: Status; editLabel?: string }) {
  const [status, setStatus] = useState<Status>(initial);
  const [mode, setMode] = useState<'none' | 'edit' | 'reject'>('none');
  const [text, setText] = useState('');

  const submit = () => {
    if (!text.trim()) return;
    setStatus(mode === 'reject' ? 'rejected' : 'pending');
    setMode('none');
    setText('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={status} />
        <Button size="sm" onClick={() => setStatus('approved')} disabled={status === 'approved'}>
          <Check className="size-3.5" /> Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode(mode === 'edit' ? 'none' : 'edit')}>
          <Pencil className="size-3.5" /> {editLabel}
        </Button>
        <Button size="sm" variant="outline" className="text-red-700" onClick={() => setMode(mode === 'reject' ? 'none' : 'reject')}>
          <X className="size-3.5" /> Reject
        </Button>
      </div>
      {mode !== 'none' && (
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === 'reject' ? 'Why is this rejected? The new version will follow this comment.' : 'Type the change, e.g. "make the headline shorter and add the deadline date"'}
          />
          <Button size="sm" onClick={submit} disabled={!text.trim()}>
            {mode === 'reject' ? 'Reject and regenerate' : 'Apply edit'}
          </Button>
        </div>
      )}
    </div>
  );
}
