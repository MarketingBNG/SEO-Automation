'use client';

import { useEffect, useRef } from 'react';

// The article preview, editable in place: click into it and type, delete or fix a word, the way it
// will read on the site. Only small fixes are meant here; a bigger rewrite goes through Word.
//
// What the page cannot show safely (scripts, frames, forms and similar) is not run: each such piece
// is shown as a grey "kept" chip and goes back into the HTML exactly as it was. Event handlers and
// javascript: links are dropped, as nothing in a blog needs them. Everything else (classes, image
// sizes, captions) stays as written, so saving a small fix never strips the rest of the blog.
const KEEP = 'script, style, iframe, object, embed, form, noscript, template, svg, math, link, meta, base, frame, frameset';
const BAD_URL = /^\s*(javascript|vbscript|data:text\/html)/i;
const MARK = '\u0001';

function toEditable(html: string, kept: string[]): string {
  // A parsed document is inert: nothing in it runs or loads while it is prepared.
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  for (const el of Array.from(doc.body.querySelectorAll(KEEP))) {
    const i = kept.push(el.outerHTML) - 1;
    const chip = doc.createElement('span');
    chip.setAttribute('data-kept', String(i));
    chip.setAttribute('contenteditable', 'false');
    chip.className = 'rounded bg-muted px-1 text-xs text-muted-foreground';
    chip.textContent = `[${el.localName} kept as is]`;
    el.replaceWith(chip);
  }
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name) || (/^(href|src|action|formaction|xlink:href|srcdoc)$/i.test(a.name) && BAD_URL.test(a.value))) el.removeAttribute(a.name);
    }
  }
  return doc.body.innerHTML;
}

function fromEditable(root: HTMLElement, kept: string[]): string {
  const copy = root.cloneNode(true) as HTMLElement;
  for (const chip of Array.from(copy.querySelectorAll('[data-kept]'))) {
    chip.replaceWith(document.createTextNode(`${MARK}${chip.getAttribute('data-kept')}${MARK}`));
  }
  return copy.innerHTML.replace(new RegExp(`${MARK}(\\d+)${MARK}`, 'g'), (_m, i) => kept[Number(i)] ?? '');
}

export function EditableArticle({ html, onChange, className }: { html: string; onChange: (html: string) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const kept = useRef<string[]>([]);
  // The HTML this box last sent up: when it comes back as `html`, the box is left alone so the
  // cursor stays where it is. Any other change (HTML box, Word upload, reload) redraws it.
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!ref.current || html === sent.current) return;
    kept.current = [];
    ref.current.innerHTML = toEditable(html, kept.current);
    sent.current = html;
  }, [html]);

  const emit = () => {
    if (!ref.current) return;
    const next = fromEditable(ref.current, kept.current);
    sent.current = next;
    onChange(next);
  };

  return (
    <div
      ref={ref}
      className={className}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline="true"
      aria-label="Article (click to edit)"
      onFocus={() => document.execCommand('defaultParagraphSeparator', false, 'p')}
      onInput={emit}
      // Pasted text arrives as plain text, so formatting from other pages or Word does not come along.
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
    />
  );
}
