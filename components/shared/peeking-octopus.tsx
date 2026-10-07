'use client';

// The assistant's octopus peeks in from the left or right edge of the screen at random moments, on
// any page of the dashboard, with a thought bubble offering help, then leaves. Clicking it opens the
// assistant. It only ever peeks from a screen edge, never the middle, and stays away for people who
// prefer reduced motion.
import { useEffect, useState } from 'react';
import { Octopus } from './octopus';

type Spot = { side: 'left' | 'right'; top: number; line: string; key: number };

const SIZE = 160; // shown size in px; in the 240px animation the octopus hides behind x = 221
const EDGE_OFFSET = Math.round(((240 - 221) / 240) * SIZE); // keeps the hiding edge on the screen edge
const PEEK_MS = 8000; // length of the peek animation
const LINES = [
  'Need a hand? I can help.',
  'Do you need any help? Just ask me.',
  'Want me to check today’s rankings?',
  'Shall I show which blogs go live this week?',
  'Curious how this month’s strategy is going?',
  'I can find pages that get views but few clicks.',
  'Stuck on something? Click me.',
  'Want a quick SEO summary of this week?',
];
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function PeekingOctopus({ onClick }: { onClick?: () => void }) {
  const [spot, setSpot] = useState<Spot | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let timer: ReturnType<typeof setTimeout>;
    let hide: ReturnType<typeof setTimeout>;
    const schedule = (first = false) => {
      timer = setTimeout(
        () => {
          if (document.visibilityState === 'visible') {
            // Upper or lower band of the screen only, never the centre.
            const top = Math.random() < 0.5 ? rand(12, 30) : rand(56, 76);
            setSpot({ side: Math.random() < 0.5 ? 'left' : 'right', top, line: LINES[Math.floor(Math.random() * LINES.length)], key: Date.now() });
            hide = setTimeout(() => setSpot(null), PEEK_MS);
          }
          schedule();
        },
        first ? rand(20_000, 45_000) : rand(90_000, 240_000)
      );
    };
    schedule(true);
    return () => {
      clearTimeout(timer);
      clearTimeout(hide);
    };
  }, []);

  if (!spot) return null;
  const left = spot.side === 'left';
  return (
    <button
      key={spot.key}
      type="button"
      onClick={() => {
        setSpot(null);
        onClick?.();
      }}
      title="Ask the assistant"
      aria-label={`${spot.line} Open the assistant`}
      className="fixed z-40 cursor-pointer border-0 bg-transparent p-0 text-left"
      style={{ top: `${spot.top}%`, [spot.side]: -EDGE_OFFSET, height: SIZE }}
    >
      <span className={`flex items-start ${left ? 'flex-row' : 'flex-row-reverse'}`}>
        {/* The animation peeks in from the right; mirror it on the left edge. */}
        <Octopus mood="peek" size={SIZE} style={{ transform: left ? 'scaleX(-1)' : undefined }} />
        {/* Thought bubble, on the side facing the page. */}
        <span className={`relative mt-2 max-w-[220px] animate-in fade-in zoom-in-95 duration-500 ${left ? '-ml-[84px]' : '-mr-[84px]'}`}>
          <span className="block rounded-2xl border bg-popover px-3 py-2 text-sm font-medium text-popover-foreground shadow-md">{spot.line}</span>
          <span className={`absolute -bottom-3 block size-3 rounded-full border bg-popover shadow-sm ${left ? 'left-3' : 'right-3'}`} />
          <span className={`absolute -bottom-6 block size-2 rounded-full border bg-popover shadow-sm ${left ? 'left-0' : 'right-0'}`} />
        </span>
      </span>
    </button>
  );
}
