'use client';

import { useMemo, type CSSProperties } from 'react';

// Minimal, safe markdown for assistant replies: everything is HTML-escaped first, then a small set
// of patterns (bold, code, http(s) links, headings, lists) is turned back into markup.
export function renderMarkdown(text: any): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  const out: string[] = [];
  let list: string | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (bullet || numbered) {
      const tag = bullet ? 'ul' : 'ol';
      if (list !== tag) {
        closeList();
        out.push(`<${tag}>`);
        list = tag;
      }
      out.push(`<li>${inline((bullet || numbered)![1])}</li>`);
    } else if (heading) {
      closeList();
      out.push(`<h4>${inline(heading[2])}</h4>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('');
}

// True for http(s) URLs and, when allowRelative, for relative ones ("/api/uploads/x.png", "#faq").
// Whitespace and control characters are removed first because browsers ignore them in a scheme
// ("java\tscript:" still runs), so anything that looks like another scheme is refused.
export function isSafeUrl(value: any, allowRelative = true) {
  const v = String(value || '').replace(/[\u0000- \u007f-\u009f]/g, '');
  if (!v) return false;
  const scheme = v.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) return /^https?$/i.test(scheme[1]);
  return allowRelative;
}

// For links whose URL came from the model or a web page (fact sources, pick targets): only
// absolute http(s) URLs become clickable.
export const safeHref = (url: any) => (isSafeUrl(url, false) ? String(url).trim() : undefined);

// WordPress titles arrive texturized (&#8217; &#8211; &amp;). React would print those literally.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–',
  mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
};
export function decodeEntities(text: any) {
  if (!text) return text;
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

// Model-written HTML (drafts and rewrites) can repeat markup from a third-party page or a search
// result, so previews keep only the article tags below. Other tags are unwrapped (their text
// stays), the ones in DROP_TAGS are removed with everything inside, and every attribute except
// a safe href / src / alt is dropped (so no on* handlers, style or javascript: URLs). Runs in the
// browser only; on the server it returns '' (draft and rewrite content is loaded client-side).
const SAFE_TAGS = new Set([
  'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'a', 'img', 'table', 'caption',
  'thead', 'tbody', 'tr', 'th', 'td', 'br', 'blockquote', 'code', 'pre', 'span', 'div',
]);
const DROP_TAGS = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'noembed',
  'noframes', 'template', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select', 'option',
  'link', 'meta', 'base', 'title', 'head', 'audio', 'video', 'source', 'track', 'canvas', 'xmp',
  'plaintext', 'portal', 'dialog',
]);
const HTML_NS = 'http://www.w3.org/1999/xhtml';

export function sanitizeArticleHtml(html: any): string {
  if (!html || typeof window === 'undefined' || typeof window.DOMParser === 'undefined') return '';
  // A DOMParser document is inert: nothing in it runs or loads while it is being cleaned.
  const doc = new window.DOMParser().parseFromString(String(html), 'text/html');
  const out = doc.createElement('div');
  const copy = (from: any, to: any): void => {
    for (const node of Array.from(from.childNodes) as any[]) {
      if (node.nodeType === 3) {
        to.appendChild(doc.createTextNode(node.nodeValue));
        continue;
      }
      if (node.nodeType !== 1) continue; // comments and the like
      const tag = node.localName;
      if (node.namespaceURI !== HTML_NS || DROP_TAGS.has(tag)) continue;
      if (!SAFE_TAGS.has(tag)) {
        copy(node, to);
        continue;
      }
      const el = doc.createElement(tag);
      if (tag === 'a') {
        const href = node.getAttribute('href');
        if (href && isSafeUrl(href)) {
          el.setAttribute('href', href.trim());
          // Always a new tab, so clicking a link in a preview never leaves the dashboard.
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }
      } else if (tag === 'img') {
        const src = node.getAttribute('src');
        if (!src || !isSafeUrl(src)) continue;
        el.setAttribute('src', src.trim());
        const alt = node.getAttribute('alt');
        if (alt !== null) el.setAttribute('alt', alt);
      } else if (tag === 'td' || tag === 'th') {
        for (const name of ['colspan', 'rowspan']) {
          const v = node.getAttribute(name);
          if (v && /^\d{1,3}$/.test(v.trim())) el.setAttribute(name, v.trim());
        }
      }
      copy(node, el);
      to.appendChild(el);
    }
  };
  copy(doc.body, out);
  return out.innerHTML;
}

// Preview of draft or rewrite HTML, always through the sanitizer above.
export function SafeHtml({ html, className, style }: { html: any; className?: string; style?: CSSProperties }) {
  const clean = useMemo(() => sanitizeArticleHtml(html), [html]);
  return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: clean }} />;
}

// JSON list columns may arrive already parsed or still as a JSON string.
export function asList(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

