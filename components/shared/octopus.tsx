'use client';

// The assistant's face: short looping pixel-octopus clips. The clips have a white background, which
// "multiply" hides on light themes; on dark themes the clip is inverted (white octopus, black
// background) and "screen" hides the black.
export type OctopusMood = 'wave' | 'peek' | 'search' | 'search-bubble' | 'thinking';

export function Octopus({ mood, size = 120, className = '', loop = true, onEnded }: { mood: OctopusMood; size?: number; className?: string; loop?: boolean; onEnded?: () => void }) {
  return (
    <video
      key={mood}
      src={`/assistant/${mood}.mp4`}
      width={size}
      height={size}
      autoPlay
      muted
      playsInline
      loop={loop}
      onEnded={onEnded}
      aria-hidden="true"
      className={`pointer-events-none select-none mix-blend-multiply [image-rendering:pixelated] dark:mix-blend-screen dark:invert ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
