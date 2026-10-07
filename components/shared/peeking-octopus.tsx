'use client';

// The assistant's octopus peeks in from the left or right edge of the screen at random moments, on
// any page of the dashboard, plays its peek clip once and leaves. Clicking it opens the assistant.
// It never appears in the middle of the screen, and stays away for people who prefer reduced motion.
import { useEffect, useState } from 'react';

type Spot = { side: 'left' | 'right'; top: number; key: number };

const SIZE = 160; // shown size in px; the clip is 240px and the octopus hides behind x = 221
const EDGE_OFFSET = Math.round(((240 - 221) / 240) * SIZE); // keeps the hiding edge on the screen edge
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function PeekingOctopus({ onClick }: { onClick?: () => void }) {
  const [spot, setSpot] = useState<Spot | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (first = false) => {
      timer = setTimeout(
        () => {
          if (document.visibilityState === 'visible') {
            // Upper or lower band of the screen only, never the centre.
            const top = Math.random() < 0.5 ? rand(12, 32) : rand(58, 80);
            setSpot({ side: Math.random() < 0.5 ? 'left' : 'right', top, key: Date.now() });
          }
          schedule();
        },
        first ? rand(20_000, 45_000) : rand(90_000, 240_000)
      );
    };
    schedule(true);
    return () => clearTimeout(timer);
  }, []);

  if (!spot) return null;
  return (
    <button
      key={spot.key}
      type="button"
      onClick={() => {
        setSpot(null);
        onClick?.();
      }}
      title="Ask the assistant"
      aria-label="Open the assistant"
      className="fixed z-40 cursor-pointer border-0 bg-transparent p-0"
      style={{ top: `${spot.top}%`, [spot.side]: -EDGE_OFFSET, width: SIZE, height: SIZE }}
    >
      <video
        src="/assistant/peek.mp4"
        width={SIZE}
        height={SIZE}
        autoPlay
        muted
        playsInline
        onEnded={() => setSpot(null)}
        aria-hidden="true"
        className="pointer-events-none select-none mix-blend-multiply [image-rendering:pixelated] dark:mix-blend-screen dark:invert"
        // The clip peeks in from the right; mirror it on the left edge.
        style={{ width: SIZE, height: SIZE, transform: spot.side === 'left' ? 'scaleX(-1)' : undefined }}
      />
    </button>
  );
}
