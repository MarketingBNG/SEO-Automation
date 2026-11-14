// Server-side allowlist cleaner for article HTML a person pastes (Post my blog), before it is saved
// and sent to the website. Same rules as the preview's sanitizeArticleHtml (components/shared/
// article.tsx), which needs a browser DOM: the HTML is read tag by tag and written out again from
// scratch, so only what is listed here survives.
//  - Allowed tags are rebuilt with only their allowed attributes, each value entity-decoded, checked
//    and quoted again. Every on* handler, style, class and id is dropped.
//  - Links: http(s), mailto, tel, relative paths and #anchors only (no javascript:, data:, vbscript:
//    or any other scheme, also when hidden with entities or control characters). Pictures: http(s),
//    relative paths, and data:image (png, jpeg, gif, webp) so a Word file's pictures can be stored.
//  - script, style, svg, math, iframe, object, embed, form and the like are dropped with their content.
//  - Other tags (font, o:p, section...) are dropped and their text kept. Comments and doctypes go.
//  - The website prints the title as the H1, so an h1 becomes an h2 (h5/h6 become h4).
// Pure: no DOM, no dependency.

const KEEP = new Set(['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 'a', 'img', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'br', 'blockquote', 'code', 'pre', 'span', 'div', 'sup', 'sub', 'hr']);
const RENAME: Record<string, string> = { h1: 'h2', h5: 'h4', h6: 'h4' };
const VOID = new Set(['br', 'img', 'hr']);
const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'noembed', 'noframes', 'template', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select', 'option', 'link', 'meta', 'base', 'title', 'head', 'audio', 'video', 'source', 'track', 'canvas', 'xmp', 'plaintext', 'portal', 'dialog', 'param']);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')' };
export function decodeEntities(s: string): string {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    const v = NAMED[e.toLowerCase()];
    return v !== undefined ? v : m;
  });
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A URL a person may click or load: the decoded value, without control characters and spaces that
// browsers ignore inside a scheme ("java\tscript:").
export function safeUrl(raw: string, kind: 'href' | 'src'): string | null {
  const v = decodeEntities(raw).replace(/[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g, '');
  if (!v) return null;
  if (kind === 'src' && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(v)) return v;
  if (/^https?:\/\/[^/\\]/i.test(v)) return v;
  if (kind === 'href' && /^(mailto|tel):/i.test(v)) return v;
  if (/^\/\//.test(v) || /^\/\\|^\\/.test(v)) return null; // protocol-relative: another site's scheme rules
  // Relative (path, ?query, #anchor): no scheme before the first / ? or #.
  const head = v.split(/[/?#]/)[0];
  if (head.includes(':')) return null;
  return v;
}

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
function attributes(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (!out.has(name)) out.set(name, m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

function openTag(tag: string, attrSrc: string): string {
  const a = attributes(attrSrc);
  const parts: string[] = [];
  if (tag === 'a') {
    const href = a.has('href') ? safeUrl(a.get('href')!, 'href') : null;
    if (href) parts.push(`href="${escAttr(href)}"`);
    const title = a.get('title');
    if (title) parts.push(`title="${escAttr(decodeEntities(title).slice(0, 300))}"`);
  } else if (tag === 'img') {
    const src = a.has('src') ? safeUrl(a.get('src')!, 'src') : null;
    if (!src) return '';
    parts.push(`src="${escAttr(src)}"`);
    parts.push(`alt="${escAttr(decodeEntities(a.get('alt') || '').slice(0, 300))}"`);
  } else if (tag === 'td' || tag === 'th') {
    for (const n of ['colspan', 'rowspan']) {
      const v = (a.get(n) || '').trim();
      if (/^\d{1,3}$/.test(v)) parts.push(`${n}="${v}"`);
    }
  }
  return `<${tag}${parts.length ? ` ${parts.join(' ')}` : ''}${VOID.has(tag) && tag !== 'br' && tag !== 'hr' ? ' /' : ''}>`;
}

// One token at a time: a comment or doctype, a tag (quoted values may hold ">"), a lone "<", or text.
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<[!?][^>]*>?|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|<|[^<]+/g;

export function sanitizeHtml(input: string): string {
  const html = String(input || '');
  let out = '';
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    const t = m[0];
    if (m[2] === undefined) {
      if (t === '<') out += '&lt;';
      else if (t[0] !== '<') out += t.replace(/>/g, '&gt;');
      continue; // comments, doctypes
    }
    const closing = m[1] === '/';
    const raw = m[2].toLowerCase();
    if (DROP.has(raw)) {
      if (closing) continue;
      // Skip to its end tag with everything inside; a tag never closed is dropped on its own.
      const end = new RegExp(`</${raw}\\s*>`, 'ig');
      end.lastIndex = TOKEN.lastIndex;
      const found = end.exec(html);
      if (found) TOKEN.lastIndex = end.lastIndex;
      continue;
    }
    const tag = RENAME[raw] || raw;
    if (!KEEP.has(tag)) continue;
    if (closing) {
      if (!VOID.has(tag)) out += `</${tag}>`;
      continue;
    }
    out += openTag(tag, m[3] || '');
  }
  return out;
}
