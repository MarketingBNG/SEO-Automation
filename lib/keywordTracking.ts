// @ts-nocheck -- reads untyped SE Ranking and Search Console rows.
// Keeps SE Ranking tracking aligned with the approved strategy (target in Settings > Blog rules):
//  1. every keyword and blog keyword in the approved strategy is always tracked (also right after
//     approval or an edit, not only on Mondays);
//  2. then Search Console queries we already appear for, and keyword research seeded from the
//     strategy's own keywords, US and India, but only results on the strategy's topics.
// So the rankings the next strategy is built from cover exactly what the strategy targets.
// Near-duplicates and brand searches are skipped.
import prisma from './prisma';
import * as settings from './settings';
import * as activity from './activity';
import { listSites, getSiteRankings, researchKeywords, addTrackedKeywords, getSubscription, listProjectKeywords } from './seranking';
import { querySearchAnalytics, comparisonRanges } from './searchConsole';
import { keywordKey, sameTopic } from './strategy/core';

const BRAND = /usaindia|usa india cfo|usaindiacfo/i;
const MAX_PER_RUN = 500;

const GENERIC = new Set(['india', 'indian', 'indians', 'us', 'usa', 'america', 'american', 'online', 'best', 'free', 'near', 'me', 'guide', 'cost', 'price', 'fees', 'how', 'what', 'why', 'when', 'which', 'the', 'for', 'and', 'to', 'of', 'in', 'a', 'is', 'from', 'with', 'vs', '2024', '2025', '2026', '2027']);
const words = (k: string) => keywordKey(k).replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 1 && !GENERIC.has(w));

// The approved strategy's keywords (priority order) and the topic words they are about.
export async function strategyTopics() {
  const s = await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' } });
  if (!s) return { keywords: [] as string[], topics: new Set<string>(), period: null };
  const plan = JSON.parse(s.plan_json);
  const kws = [...(plan.keywords || [])].sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0)).map((k) => k.keyword);
  const keywords = [...new Set([...kws, ...(plan.blogPlan?.calendar || []).map((b) => b.mainKeyword), ...(plan.aeoGeo?.items || []).map((i) => i.target)].filter(Boolean))];
  const topics = new Set<string>();
  for (const k of [...keywords, ...(plan.keywords || []).map((k) => k.cluster || ''), ...(plan.blogPlan?.calendar || []).map((b) => b.cluster || '')]) for (const w of words(k)) topics.add(w);
  return { keywords, topics, period: s.period };
}

// Only the approved strategy's keywords (used right after approval or an edit).
export async function syncStrategyKeywords({ add = addTrackedKeywords } = {}) {
  return topUpTrackedKeywords({ add, strategyOnly: true });
}

export async function topUpTrackedKeywords({ add = addTrackedKeywords, strategyOnly = false } = {}) {
  const target = Math.max(20, Number(await settings.get('tracked_keyword_target')) || 1500);
  const sites = await listSites();
  if (!sites?.length) return { skipped: 'No SE Ranking project' };
  // All tracked keywords (the list endpoint also has ones not checked yet; rankings as a fallback).
  const names = await listProjectKeywords(sites[0].id).catch(async () => (await getSiteRankings(sites[0].id)).map((r) => r.keyword));
  const tracked = new Set(names.map((k) => keywordKey(k)));
  const strategy = await strategyTopics();
  const onTopic = (k) => !strategy.topics.size || words(k).some((w) => strategy.topics.has(w));

  const picked: string[] = [];
  const take = (k) => {
    const key = keywordKey(k);
    if (!key || key.length < 4 || key.split(' ').length > 8 || BRAND.test(key) || tracked.has(key)) return;
    if (picked.some((p) => sameTopic(p, key))) return;
    picked.push(key);
  };

  // 1. The approved strategy's keywords: always tracked, whatever the target.
  for (const k of strategy.keywords) take(k);
  const fromStrategy = picked.length;
  const need = strategyOnly ? fromStrategy : Math.max(fromStrategy, Math.min(MAX_PER_RUN, target - tracked.size));
  // Extra keywords must be on the strategy's topics.
  const takeOnTopic = (k) => {
    if (onTopic(k)) take(k);
  };

  // 2. Search Console queries with impressions (we already appear for them).
  if (!strategyOnly && picked.length < need) {
    try {
      const { current } = comparisonRanges(90);
      const rows = await querySearchAnalytics({ ...current, dimensions: ['query'], rowLimit: 1000 });
      for (const r of rows.sort((a, b) => b.impressions - a.impressions)) if (r.impressions >= 20) takeOnTopic(r.keys[0]);
    } catch {}
  }

  // 3. Keyword research for each focus service, US and India: only with API credits above the reserve
  //    kept for blog research (Search Console and strategy keywords above cost no credits).
  let unitsLeft = null;
  try {
    unitsLeft = Number((await getSubscription())?.units_left);
  } catch {}
  const reserve = Number(await settings.get('seranking_reserve_units')) || 20000;
  const canResearch = unitsLeft === null || !Number.isFinite(unitsLeft) || unitsLeft > reserve;
  if (!strategyOnly && picked.length < need && canResearch) {
    const focus = String((await settings.get('focus_services')) || 'ITIN\nEIN\nUS company formation for Indians\nNRI tax\nFEMA compliance\nvirtual CFO').split(/\n|;/).map((x) => x.trim()).filter(Boolean);
    // Seeds: the focus services, then the strategy's own keywords. Each seed is researched in the US
    // and India, related keywords first, then similar, long-tail and question keywords, until the
    // week's quota is reached or the credits fall to the reserve.
    // Seeds come from the strategy first (its top keywords), then the focus services.
    const seeds = [...new Set([...strategy.keywords.slice(0, 25), ...focus])];
    outer: for (const type of ['related', 'similar', 'longtail', 'questions']) {
      for (const seed of seeds) {
        for (const source of ['us', 'in']) {
          if (picked.length >= need) break outer;
          const rows = await researchKeywords(type, seed, { source, limit: 100 }).catch(() => []);
          for (const r of rows.filter((x) => (x.volume || 0) >= 10).sort((a, b) => (b.volume || 0) - (a.volume || 0))) takeOnTopic(r.keyword);
        }
      }
      try {
        const left = Number((await getSubscription())?.units_left);
        if (Number.isFinite(left) && left <= reserve) break;
      } catch {}
    }
  }

  const list = picked.slice(0, need);
  const strategyAdded = Math.min(fromStrategy, list.length);
  const added = list.length ? await add(list) : 0;
  await activity.log('seranking.keywords_added', { details: `${added} keyword(s) added to rank tracking (${strategyAdded} from the ${strategy.period || 'current'} strategy; ${tracked.size + added} tracked, target ${target})` });
  return { tracked: tracked.size + added, target, added, strategyAdded, keywords: list, unitsLeft, researchSkipped: !canResearch };
}
