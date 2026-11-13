// The partners whose names blogs are published under; one is picked at random for each post.
// The website knows each by an author slug (lib/siteConnector.ts authorSlug, SITE_CONNECTOR_AUTHORS).
// The list can be changed in settings ("blog_authors", one name per line).
import * as settings from './settings';

export const DEFAULT_AUTHORS = ['Harsh Jain', 'Naman Gangwal', 'Amit Agarwal', 'Akshay Nahar'];

export async function authorNames(): Promise<string[]> {
  const v = String((await settings.get('blog_authors')) || '').split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  return v.length ? v : DEFAULT_AUTHORS;
}

export const pickAuthor = (names: string[], rnd = Math.random) => names[Math.floor(rnd() * names.length)];
