import prisma from './prisma';
import { auditBlog } from './anthropic';
import { wordCount } from './validation';
import { getPost } from './wordpress';
import * as activity from './activity';

export function parseAuditRow(row) {
  return {
    ...row,
    issues: JSON.parse(row.issues || '[]'),
    suggestions: JSON.parse(row.suggestions || '[]'),
    facts: JSON.parse(row.facts || '[]'),
    people_also_ask: JSON.parse(row.people_also_ask || '[]'),
    rewrite_people_also_ask: JSON.parse(row.rewrite_people_also_ask || '[]'),
  };
}

// Best-effort title for a fetched page (a friend's blog URL has no title field), used to look up
// the topic's live Google questions.
function titleFromHtml(html) {
  const raw = (String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  if (!raw) return null;
  const text = raw.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, "'").replace(/\s+/g, ' ').trim();
  return text.split(/\s[|–-]\s/)[0].slice(0, 120) || null;
}

// Runs a full audit on pasted content, a public URL, or an existing WordPress post, and stores it.
export async function createAudit({ title, contentHtml, sourceUrl, wpPostId }) {
  let content = contentHtml;
  let resolvedTitle = title;
  let resolvedUrl = sourceUrl || null;

  if (wpPostId) {
    // Clean source: the post's actual content via the WordPress API, no page-chrome noise.
    const post = await getPost(wpPostId);
    content = post.content.rendered;
    resolvedTitle = resolvedTitle || post.title.rendered;
    resolvedUrl = post.link;
  } else if (sourceUrl && !content) {
    const pageRes = await fetch(sourceUrl);
    if (!pageRes.ok) {
      const err: any = new Error(`Could not fetch that URL (HTTP ${pageRes.status})`);
      err.status = 400;
      throw err;
    }
    content = await pageRes.text();
  }

  if (!content || !content.trim()) {
    const err: any = new Error('Provide contentHtml, a sourceUrl, or a wpPostId');
    err.status = 400;
    throw err;
  }

  if (!resolvedTitle && sourceUrl) resolvedTitle = titleFromHtml(content);

  const result = await auditBlog({ title: resolvedTitle, content, sourceUrl: resolvedUrl });

  const dbResult = await prisma.blog_audits.create({
    data: {
      title: resolvedTitle || null,
      source_url: resolvedUrl,
      content_html: content,
      verdict: result.verdict,
      summary: result.summary,
      issues: JSON.stringify(result.issues),
      suggestions: JSON.stringify(result.suggestions),
      facts: JSON.stringify(result.facts),
      word_count: wordCount(content),
      wp_post_id: wpPostId || null,
      wp_post_url: wpPostId ? resolvedUrl : null,
      people_also_ask: JSON.stringify(result.peopleAlsoAsk || []),
    },
  });

  await activity.log('audit.completed', {
    entityType: 'blog_audit',
    entityId: dbResult.id,
    details: `"${resolvedTitle || resolvedUrl}" → ${result.verdict}, ${result.issues.length} issue(s)`,
  });

  return parseAuditRow(await prisma.blog_audits.findUnique({ where: { id: dbResult.id } }));
}
