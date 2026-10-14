// A Word file back into a blog. Usually the file is one downloaded from Drafts & Review (see
// lib/blogDoc.ts), edited in Word and uploaded again, so what the download added around the article
// is taken off again: the grey info block, the cover, the title line and the byline. What the
// download changed inside the article is turned back: image notes become [VISUAL SUGGESTION: ...]
// again, a table's bold line above it becomes its caption again and its first row the header row.
// Pure: mammoth's HTML in, the blog's HTML out. Pictures are left as data: URIs for the route.

const text = (s: string) =>
  String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const INFO_NOTE = /^\s*(?:<p>(?:\s|&nbsp;)*<\/p>\s*)*<p>(?:(?!<\/p>)[\s\S])*This grey block is not part of the post(?:(?!<\/p>)[\s\S])*<\/p>\s*/i;

// "By <b>Author</b>. Reviewed by <b>Reviewer</b>. Last reviewed 1 May 2026." as lib/byline.ts writes it.
const BYLINE = /<p>\s*(?:By <strong>[^<]*<\/strong>\.(?:\s*Reviewed by <strong>[^<]*<\/strong>\.\s*Last reviewed [^<]*\.)?|Reviewed by <strong>[^<]*<\/strong>\.\s*Last reviewed [^<]*\.)\s*<\/p>\s*/i;

function infoValue(table: string, label: string): string | null {
  const m = table.match(new RegExp(`<td>\\s*(?:<p>)?\\s*<strong>${label}</strong>[\\s\\S]*?</td>\\s*<td>([\\s\\S]*?)</td>`, 'i'));
  return m ? text(m[1]).replace(/\s*\(\d+ characters\)$/, '') : null;
}

// mammoth wraps every cell in a paragraph and has no header rows; the writer's tables have both.
function fixTable(table: string): string {
  let t = table.replace(/<(td|th)([^>]*)>\s*<p>((?:(?!<\/?p\b)[\s\S])*)<\/p>\s*<\/\1>/gi, '<$1$2>$3</$1>');
  if (/<th\b/i.test(t) || /<thead\b/i.test(t)) return t;
  const rows = [...t.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
  if (rows.length < 2) return t;
  const head = rows[0][0].replace(/<td\b/gi, '<th').replace(/<\/td>/gi, '</th>');
  const open = t.match(/^<table\b[^>]*>(\s*<caption>[\s\S]*?<\/caption>)?/i)?.[0] || '<table>';
  t = `${open}<thead>${head}</thead><tbody>${rows.slice(1).map((r) => r[0]).join('')}</tbody></table>`;
  return t;
}

export type WordBlog = { title: string | null; meta: string | null; content: string };

export function blogFromWordHtml(input: string): WordBlog {
  let html = String(input || '');
  let title: string | null = null;
  let meta: string | null = null;

  // The grey info block (a note and a table) at the top of a downloaded file.
  const note = html.match(INFO_NOTE);
  if (note) {
    html = html.slice(note[0].length);
    const table = html.match(/^\s*<table\b[\s\S]*?<\/table>\s*/i);
    if (table) {
      meta = infoValue(table[0], 'Meta description');
      html = html.slice(table[0].length);
    }
  }

  // The title line: the first Heading 1 before any section heading. The cover sits above it.
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const h2At = html.search(/<h2\b/i);
  if (h1 && (h2At < 0 || h1.index! < h2At)) {
    title = text(h1[1]) || null;
    html = html.slice(h1.index! + h1[0].length);
  }

  html = html
    .replace(BYLINE, '')
    // Image notes, as lib/blogDoc.ts writes them, back into the writer's form.
    .replace(/<p>\s*<strong>Image to add here:<\/strong>\s*((?:(?!<\/p>)[\s\S])*)<\/p>/gi, (_m, t) => `<p>[VISUAL SUGGESTION: ${text(t)}]</p>`)
    .replace(/<strong>\[Image to add here:\s*([^\]]*)\]<\/strong>/gi, (_m, t) => `[VISUAL SUGGESTION: ${text(t)}]`)
    .replace(/<strong>\s*(?:<u>)?\s*(\[(?:PRACTITIONER NOTE NEEDED|VERIFY)[^\]]*\])\s*(?:<\/u>)?\s*<\/strong>/gi, '$1')
    // A bold line right above a table was its caption.
    .replace(/<p>\s*<strong>((?:(?!<\/?(?:strong|p)\b)[\s\S]){1,300})<\/strong>\s*<\/p>\s*<table>/gi, (_m, cap) => `<table><caption>${cap.trim()}</caption>`)
    .replace(/<table\b[\s\S]*?<\/table>/gi, fixTable)
    // Word bookmarks (empty anchors) and empty paragraphs.
    .replace(/<a id="[^"]*"\s*><\/a>/gi, '')
    .replace(/<p>\s*<\/p>/gi, '')
    // Links only to web pages, e-mail, phone numbers and places on the page.
    .replace(/(<a\b[^>]*?)\s+href="(?!https?:|mailto:|tel:|#|\/)[^"]*"/gi, '$1')
    .trim();

  return { title, meta, content: html };
}

// The pictures in the HTML (data: URIs from mammoth), in order.
export function dataImages(html: string): { tag: string; mime: string; base64: string; alt: string }[] {
  return [...String(html || '').matchAll(/<img\b[^>]*\bsrc="data:(image\/[\w.+-]+);base64,([^"]+)"[^>]*>/gi)].map((m) => ({
    tag: m[0],
    mime: m[1].toLowerCase(),
    base64: m[2],
    alt: (m[0].match(/\balt="([^"]*)"/i) || [])[1] || '',
  }));
}
