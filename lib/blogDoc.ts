// A blog as a Word file, laid out the way it will be published: cover image, title, byline, the
// article (with any images already placed), FAQ and call to action. A short grey info block at the
// top (not part of the post) gives the URL, meta title and description, status and author, so a
// reviewer can check everything from one file or forward it.
import prisma from './prisma';
import { readFile, mimeFor } from './storage';
import { makeCover, coverAlt } from './cover';
import { withByline } from './byline';
import { htmlToDocx } from './docx';
import { seoSlug } from './wordpress';
import { inlineImageKeys, decodeKey } from './blogImages';

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SITE = () => (process.env.WORDPRESS_SITE_URL || 'https://usaindiacfo.com').replace(/\/+$/, '');

export type BlogDocInput = {
  title: string;
  meta: string;
  content: string;
  author?: string | null;
  reviewer?: string | null;
  cover?: string | null; // data URI
  coverAlt?: string | null;
  url: string;
  status: string;
  keyword?: string | null;
  words?: number | null;
  images: Record<string, string>; // storage key -> data URI
  now?: Date;
};

// Pure: the HTML the Word file is built from.
export function blogDocHtml(d: BlogDocInput): string {
  let body = String(d.content || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi, '$1')
    // Dashboard images become part of the file.
    .replace(/<img\b([^>]*)\bsrc="\/api\/uploads\/([^"]+)"/gi, (m, pre, key) => {
      const data = d.images[decodeKey(key)];
      return data ? `<img${pre}src="${data}"` : m;
    })
    // Any other picture (a web address, or a dashboard file that is missing) is named, not fetched:
    // the file is built on the server and must never download from an address found in the text.
    .replace(/<img\b[^>]*>/gi, (m) => {
      if (/\bsrc="data:image\//i.test(m)) return m;
      const alt = (m.match(/\balt="([^"]*)"/i) || [])[1] || '';
      const src = (m.match(/\bsrc="([^"]*)"/i) || [])[1] || '';
      return `<em>[Image${alt ? `: ${alt}` : ''}${src ? ` (${src.slice(0, 200)})` : ''}]</em>`;
    })
    // Notes for the team stand out, so a reviewer sees what still has to be done. A note that is a
    // paragraph of its own becomes a boxed note; one inside a sentence stays in the sentence.
    .replace(/<p[^>]*>\s*(\[VISUAL SUGGESTION:?[^\]]{0,500}\])\s*<\/p>|(\[VISUAL SUGGESTION:?[^\]]{0,500}\])/gi, (_m, a, b) => {
      const text = esc(String(a || b).replace(/^\[VISUAL SUGGESTION:?\s*/i, '').replace(/\]$/, ''));
      return a ? `<blockquote><p><strong>Image to add here:</strong> ${text}</p></blockquote>` : `<strong>[Image to add here: ${text}]</strong>`;
    })
    .replace(/\[(PRACTITIONER NOTE NEEDED|VERIFY)[^\]]{0,500}\]/gi, (m) => `<strong><u>${esc(m)}</u></strong>`)
    // Word has no table caption, so it becomes a bold line above the table.
    .replace(/(<table\b[^>]*>)\s*<caption\b[^>]*>([\s\S]*?)<\/caption>/gi, (_m, open, cap) => `<p><strong>${cap}</strong></p>${open}`);
  body = withByline(body, d.author || null, d.reviewer || null, d.now || new Date());

  const info = `
    <p><em>Preview of the published post, made ${esc((d.now || new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }))}. This grey block is not part of the post.</em></p>
    <table border="1" cellpadding="4" style="border-collapse:collapse;width:100%">
      <tr><td><b>Will be published at</b></td><td>${esc(d.url)}</td></tr>
      <tr><td><b>Meta title</b></td><td>${esc(d.title)} (${String(d.title || '').length} characters)</td></tr>
      <tr><td><b>Meta description</b></td><td>${esc(d.meta)} (${String(d.meta || '').length} characters)</td></tr>
      <tr><td><b>Status</b></td><td>${esc(d.status)}</td></tr>
      <tr><td><b>Author</b></td><td>${esc(d.author || 'assigned when published')}</td></tr>
      <tr><td><b>Cover image alt text</b></td><td>${esc(d.coverAlt || d.title)}</td></tr>
      ${d.keyword ? `<tr><td><b>Target keyword</b></td><td>${esc(d.keyword)}</td></tr>` : ''}
      ${d.words ? `<tr><td><b>Words</b></td><td>${d.words}</td></tr>` : ''}
    </table>
    <hr/>`;
  const cover = d.cover ? `<p><img src="${d.cover}" width="624" height="328" alt="${esc(d.coverAlt || d.title).replace(/"/g, '&quot;')}"/></p>` : '';
  return `${info}${cover}<h1>${esc(d.title)}</h1>${body}`;
}

async function dataUri(key: string): Promise<string | null> {
  const buf = await readFile(key);
  return buf ? `data:${mimeFor(key)};base64,${buf.toString('base64')}` : null;
}

// Builds the Word file for one draft (the cover is made on the fly when the draft has none).
export async function renderBlogDocx(draftId: number): Promise<{ buffer: Buffer; filename: string } | null> {
  const draft: any = await prisma.drafts.findUnique({ where: { id: draftId }, include: { keyword: { select: { keyword: true } } } });
  if (!draft) return null;
  const row = await prisma.blog_schedule.findFirst({ where: { draft_id: draftId }, select: { author: true, expert_reviewer: true, main_keyword: true, status: true } });
  const author = row?.author || draft.author || null;
  const keyword = row?.main_keyword || draft.keyword?.keyword || null;
  const images: Record<string, string> = {};
  for (const key of inlineImageKeys(draft.content_html || '')) {
    const uri = await dataUri(key);
    if (uri) images[key] = uri;
  }
  let cover: string | null = null;
  if (draft.featured_image_path) cover = await dataUri(draft.featured_image_path);
  if (!cover) cover = `data:image/png;base64,${(await makeCover(draft.title || keyword || 'Untitled', author)).toString('base64')}`;
  const html = blogDocHtml({
    title: draft.title || '',
    meta: draft.meta_description || '',
    content: draft.content_html || '',
    author,
    reviewer: row?.expert_reviewer || null,
    cover,
    coverAlt: coverAlt(draft),
    url: draft.wp_post_url || `${SITE()}/${seoSlug(keyword || draft.title || '')}/`,
    status: draft.wp_post_url ? 'Published' : row ? `${draft.status.replace('_', ' ')} (strategy blog: ${row.status.replace('_', ' ')})` : draft.status.replace('_', ' '),
    keyword,
    words: draft.word_count,
    images,
  });
  const buffer = await htmlToDocx(html, { title: draft.title || 'Blog draft', margins: { top: 720, bottom: 720, left: 900, right: 900 } });
  const filename = `${seoSlug(draft.title || keyword || 'blog').slice(0, 60) || 'blog'}.docx`;
  return { buffer, filename };
}
