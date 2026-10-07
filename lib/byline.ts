// Byline and expert schema added to every published post (author, CA/CPA reviewer, review date).
// K3: visible byline (author, CA/CPA reviewer, last reviewed date) after the opening answer.
export function withByline(html: string, author?: string | null, reviewer?: string | null, now = new Date()): string {
  if (!author && !reviewer) return html;
  const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const parts = [author ? `By <strong>${author}</strong>` : '', reviewer ? `Reviewed by <strong>${reviewer}</strong>` : '', reviewer ? `Last reviewed ${date}` : ''].filter(Boolean);
  const line = `<p class="uic-byline">${parts.join('. ')}.</p>`;
  const clean = String(html).replace(/<p[^>]*>\s*By \[?[^<]*Reviewed by[^<]*<\/p>\s*/i, '');
  const i = clean.indexOf('</p>');
  return i > 0 ? clean.slice(0, i + 4) + '\n' + line + clean.slice(i + 4) : line + clean;
}

// Article schema with the author and the expert reviewer (E-E-A-T signals for tax content).
export function expertSchema({ title, author, reviewer }: { title: string; author?: string | null; reviewer?: string | null }, now = new Date()): string | null {
  if (!author && !reviewer) return null;
  const person = (s: string) => {
    const [name, ...cred] = String(s).split(',').map((x) => x.trim());
    return { '@type': 'Person', name, ...(cred.length ? { jobTitle: cred.join(', ') } : {}), worksFor: { '@type': 'Organization', name: 'USAIndiaCFO', url: 'https://usaindiacfo.com' } };
  };
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    ...(reviewer ? { reviewedBy: person(reviewer), lastReviewed: now.toISOString().slice(0, 10) } : {}),
    mainEntity: { '@type': 'Article', headline: title, ...(author ? { author: person(author) } : {}), publisher: { '@type': 'Organization', name: 'USAIndiaCFO', url: 'https://usaindiacfo.com' } },
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

