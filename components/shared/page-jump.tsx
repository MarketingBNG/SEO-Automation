'use client';

// Less scrolling on long pages: a row of the page's sections (its card titles) at the top, and a
// floating "Sections" list and "Top" button while you scroll. Reads the page as it is drawn; changes
// nothing on it.
import { useEffect, useState } from 'react';
import { ArrowUp, List } from 'lucide-react';

type Item = { label: string; el: HTMLElement };

function sections(root: HTMLElement): Item[] {
  const out: Item[] = [];
  for (const t of root.querySelectorAll<HTMLElement>('[data-slot="card-title"]')) {
    const card = t.closest<HTMLElement>('[data-slot="card"]');
    // Only the page's own cards, not cards inside cards or in hidden parts.
    if (!card || card.parentElement?.closest('[data-slot="card"]') || card.offsetParent === null) continue;
    const label = (t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48);
    if (label) out.push({ label, el: card });
  }
  return out;
}

export function PageJump({ rootId }: { rootId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let t: any = null;
    let obs: MutationObserver | null = null;
    // The page may mount a moment after this bar; wait for it.
    const wait = setInterval(() => {
      const root = document.getElementById(rootId);
      if (!root) return;
      clearInterval(wait);
      const read = () => {
        clearTimeout(t);
        t = setTimeout(() => setItems(sections(root)), 300);
      };
      read();
      obs = new MutationObserver(read);
      obs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }, 200);
    return () => {
      clearInterval(wait);
      obs?.disconnect();
      clearTimeout(t);
    };
  }, [rootId]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 600);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const go = (el: HTMLElement) => {
    el.style.scrollMarginTop = '7.5rem';
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setOpen(false);
  };

  const many = items.length >= 4;
  return (
    <>
      {many && (
        <nav aria-label="Sections on this page" className="mb-4 flex flex-wrap gap-1.5">
          {items.map((it, i) => (
            <button key={i} type="button" onClick={() => go(it.el)} className="rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
              {it.label}
            </button>
          ))}
        </nav>
      )}
      {scrolled && (
        <div className="fixed right-4 bottom-4 z-30 flex flex-col items-end gap-2">
          {open && many && (
            <div className="max-h-[60vh] w-64 overflow-auto rounded-lg border bg-background p-1 shadow-lg">
              {items.map((it, i) => (
                <button key={i} type="button" onClick={() => go(it.el)} className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                  {it.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            {many && (
              <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded-full border bg-background px-3 py-1.5 text-sm shadow-md hover:bg-muted" aria-label="Jump to a section">
                <List className="size-4" /> Sections
              </button>
            )}
            <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-1 rounded-full border bg-background px-3 py-1.5 text-sm shadow-md hover:bg-muted" aria-label="Back to top">
              <ArrowUp className="size-4" /> Top
            </button>
          </div>
        </div>
      )}
    </>
  );
}
