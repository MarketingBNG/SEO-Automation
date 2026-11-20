// Byline and expert schema added to every published post (author, CA/CPA reviewer, review date).
// K3: visible byline (author, CA/CPA reviewer, last reviewed date) after the opening answer.
export function withByline(html: string, author?: string | null, reviewer?: string | null, now = new Date()): string {
  if (!author && !reviewer) return html;
  const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const parts = [author ? `By <strong>${author}</strong>` : '', reviewer ? `Reviewed by <strong>${reviewer}</strong>` : '', reviewer ? `Last reviewed ${date}` : ''].filter(Boolean);
  const line = `<p class="uic-byline">${parts.join('. ')}.</p>`;
  const clean = String(html).replace(/<p[^>]*>\s*By \[?[^<]*Reviewed by[^<]*<\/p>\s*/i, '');
  // After the first paragraph that has words (an image-only paragraph at the top is skipped).
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let at = -1;
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    if (m[1].replace(/<[^>]+>/g, '').trim()) {
      at = m.index + m[0].length;
      break;
    }
  }
  return at > 0 ? clean.slice(0, at) + '\n' + line + clean.slice(at) : line + clean;
}

// A person in schema.org terms ("Name, credential" gives the job title), working for USAIndiaCFO.
export function schemaPerson(s: string) {
  const [name, ...cred] = String(s).split(',').map((x) => x.trim());
  return { '@type': 'Person', name, ...(cred.length ? { jobTitle: cred.join(', ') } : {}), worksFor: { '@type': 'Organization', name: 'USAIndiaCFO', url: 'https://usaindiacfo.com' } };
}

const escHtml = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ARTICLE = /^(Article|BlogPosting|NewsArticle)$/;

// A live post's author changed: the visible byline names the new author (the reviewer and review date
// stay as they are) and the article schema's author is replaced. A post without a byline gets one, as
// publishing adds it; a post without article schema gets the expert schema.
export function withAuthor(html: string, author: string, title = ''): string {
  let out = String(html || '');
  let byline = false;
  out = out.replace(/<p class="uic-byline">[\s\S]*?<\/p>/i, (m) => {
    byline = true;
    return /By <strong>[^<]*<\/strong>/.test(m) ? m.replace(/By <strong>[^<]*<\/strong>/, `By <strong>${escHtml(author)}</strong>`) : m.replace(/<p class="uic-byline">/, `<p class="uic-byline">By <strong>${escHtml(author)}</strong>. `);
  });
  if (!byline) out = withByline(out, escHtml(author), null);
  let schema = false;
  out = out.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi, (m, json) => {
    try {
      const data = JSON.parse(json);
      let touched = false;
      const fix = (o: any) => {
        if (o && typeof o === 'object' && ARTICLE.test(String(o['@type'] || ''))) {
          o.author = schemaPerson(author);
          touched = true;
        }
      };
      fix(data);
      fix(data?.mainEntity);
      if (Array.isArray(data?.['@graph'])) data['@graph'].forEach(fix);
      if (!touched) return m;
      schema = true;
      return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
    } catch {
      return m;
    }
  });
  if (!schema) out = `${out}\n${expertSchema({ title, author }) || ''}`;
  return out;
}

// Article schema with the author and the expert reviewer (E-E-A-T signals for tax content).
export function expertSchema({ title, author, reviewer, image }: { title: string; author?: string | null; reviewer?: string | null; image?: string | null }, now = new Date()): string | null {
  if (!author && !reviewer) return null;
  const person = schemaPerson;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    ...(reviewer ? { reviewedBy: person(reviewer), lastReviewed: now.toISOString().slice(0, 10) } : {}),
    mainEntity: { '@type': 'Article', headline: title, ...(image ? { image } : {}), ...(author ? { author: person(author) } : {}), publisher: { '@type': 'Organization', name: 'USAIndiaCFO', url: 'https://usaindiacfo.com' } },
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

