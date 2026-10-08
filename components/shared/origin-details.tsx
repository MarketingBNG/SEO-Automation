'use client';

// Where a blog came from and what happened to it, for the admin: a label, and an arrow that
// opens the details. Rows without `origin` (other roles) show nothing.
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const TONE: Record<string, string> = {
  'Created by dashboard': 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
  'New upload': 'border-blue-500/40 text-blue-700 dark:text-blue-400',
  Old: 'border-border text-muted-foreground',
  'From a link': 'border-border text-muted-foreground',
};

export function OriginLabel({ label, lines }: { label: string; lines: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1" aria-expanded={open} title="Show where this came from and what happened to it">
        <span className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${TONE[label] || TONE.Old}`}>{label}</span>
        <ChevronDown className={`size-3 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="mt-1 ml-4 list-disc space-y-0.5 text-muted-foreground">
          {lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </div>
  );
}
