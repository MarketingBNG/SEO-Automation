// The partners whose names blogs are published under; one is picked at random for each post.
// Each must exist as a WordPress user (any role that can author posts). The list can be changed in
// settings ("blog_authors", one name per line); the WordPress user ids are looked up and cached.
import * as settings from './settings';
import { wpRequest } from './wordpress';

export const DEFAULT_AUTHORS = ['Harsh Jain', 'Naman Gangwal', 'Amit Agarwal', 'Akshay Nahar'];

export async function authorNames(): Promise<string[]> {
  const v = String((await settings.get('blog_authors')) || '').split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  return v.length ? v : DEFAULT_AUTHORS;
}

export const pickAuthor = (names: string[], rnd = Math.random) => names[Math.floor(rnd() * names.length)];

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// The WordPress user id for a name, or null when no such user exists.
export async function wpAuthorId(name: string): Promise<number | null> {
  const cache = JSON.parse((await settings.get('wp_author_ids')) || '{}');
  if (cache[name]) return cache[name];
  const first = name.split(/\s+/)[0];
  const { json } = await wpRequest('GET', '/wp/v2/users', { query: { search: first, per_page: 50, context: 'edit', _fields: 'id,name,slug,first_name,last_name' } }).catch(() => ({ json: [] }));
  const hit = (json || []).find((u: any) => norm(u.name) === norm(name) || norm(`${u.first_name}${u.last_name}`) === norm(name) || norm(u.slug) === norm(name));
  if (!hit) return null;
  cache[name] = hit.id;
  await settings.set('wp_author_ids', JSON.stringify(cache));
  return hit.id;
}
