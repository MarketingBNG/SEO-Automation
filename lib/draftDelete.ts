// Whether a deleted draft's keyword goes back to the manual queue ("Generate next blog draft").
// Only a plain blog that never went live: a calendar blog ('Strategy #N') is written again by the
// schedule with a new keyword, a LinkedIn article is not a blog, a topic's blog is started again
// from Topics, and a live post's topic is already on the website. Re-queueing those would write
// (and pay for) the same piece twice.
export function requeueAfterDelete(draft: { kind?: string | null; wp_post_url?: string | null }, batchName?: string | null) {
  const batch = String(batchName || '');
  if ((draft.kind || 'blog') !== 'blog' || draft.wp_post_url) return false;
  return !batch.startsWith('Strategy #') && batch !== 'LinkedIn articles' && batch !== 'Topics';
}
