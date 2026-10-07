'use client';

// The assistant's face: short looping pixel-octopus animations (animated WebP with a transparent
// background, so the dashboard's own background shows through). On dark themes the colours are
// inverted, so the octopus is white on the dark background.
export type OctopusMood = 'wave' | 'peek' | 'search' | 'search-bubble' | 'thinking';

export function Octopus({ mood, size = 120, className = '', style }: { mood: OctopusMood; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={mood}
      src={`/assistant/${mood}.webp`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`pointer-events-none select-none [image-rendering:pixelated] dark:invert ${className}`}
      style={{ width: size, height: size, ...style }}
    />
  );
}
