// @ts-nocheck -- reads untyped SE Ranking and Search Console rows.
// I2: keeps 300-500 keywords tracked in SE Ranking (target in Settings > Blog rules). Every week it
// adds the most useful missing ones: the approved strategy's keywords first, then Search Console
// queries we already get impressions for, then keyword research for the focus services in the US and
// India. Near-duplicates and brand searches are skipped.
import prisma from './prisma';
import * as settings from './settings';
import * as activity from './activity';
import { listSites, getSiteRankings, researchKeywords, addTrackedKeywords, getSubscription, listProjectKeywords } from './seranking';
import { querySearchAnalytics, comparisonRanges } from './searchConsole';
import { keywordKey, sameTopic } from './strategy/core';

const BRAND = /usaindia|usa india cfo|usaindiacfo/i;
const MAX_PER_RUN = 500;

export async function topUpTrackedKeywords({ add = addTrackedKeywords } = {}) {
  const target = Math.max(20, Number(await settings.get('tracked_keyword_target')) || 1500);
  const sites = await listSites();
  if (!sites?.length) return { skipped: 'No SE Ranking project' };
  // All tracked keywords (the list endpoint also has ones not checked yet; rankings as a fallback).
  const names = await listProjectKeywords(sites[0].id).catch(async () => (await getSiteRankings(sites[0].id)).map((r) => r.keyword));
  const tracked = new Set(names.map((k) => keywordKey(k)));
  const need = Math.min(MAX_PER_RUN, target - tracked.size);
  if (need <= 0) return { tracked: tracked.size, target, added: 0 };

  const picked: string[] = [];
  const take = (k) => {
    const key = keywordKey(k);
    if (!key || key.length < 4 || key.split(' ').length > 8 || BRAND.test(key) || tracked.has(key)) return;
    if (picked.some((p) => sameTopic(p, key))) return;
    picked.push(key);
  };

  // 1. The approved strategy's keywords.
  const s = await prisma.seo_strategies.findFirst({ where: { status: 'approved', plan_json: { not: null } }, orderBy: { id: 'desc' } });
  if (s) {
    const plan = JSON.parse(s.plan_json);
    for (const k of plan.keywords || []) take(k.keyword);
    for (const b of plan.blogPlan?.calendar || []) take(b.mainKeyword);
  }
  for (const k of await prisma.strategy_keywords.findMany({ select: { keyword: true }, orderBy: { id: 'desc' }, take: 300 }).catch(() => [])) take(k.keyword);

  // 2. Search Console queries with impressions (we already appear for them).
  if (picked.length < need) {
    try {
      const { current } = comparisonRanges(90);
      const rows = await querySearchAnalytics({ ...current, dimensions: ['query'], rowLimit: 1000 });
      for (const r of rows.sort((a, b) => b.impressions - a.impressions)) if (r.impressions >= 20) take(r.keys[0]);
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
  if (picked.length < need && canResearch) {
    const focus = String((await settings.get('focus_services')) || 'ITIN\nEIN\nUS company formation for Indians\nNRI tax\nFEMA compliance\nvirtual CFO').split(/\n|;/).map((x) => x.trim()).filter(Boolean);
    // Seeds: the focus services, then the strategy's own keywords. Each seed is researched in the US
    // and India, related keywords first, then similar, long-tail and question keywords, until the
    // week's quota is reached or the credits fall to the reserve.
    const seeds = [...new Set([...focus, ...picked.slice(0, 20)])];
    outer: for (const type of ['related', 'similar', 'longtail', 'questions']) {
      for (const seed of seeds) {
        for (const source of ['us', 'in']) {
          if (picked.length >= need) break outer;
          const rows = await researchKeywords(type, seed, { source, limit: 100 }).catch(() => []);
          for (const r of rows.filter((x) => (x.volume || 0) >= 10).sort((a, b) => (b.volume || 0) - (a.volume || 0))) take(r.keyword);
        }
      }
      try {
        const left = Number((await getSubscription())?.units_left);
        if (Number.isFinite(left) && left <= reserve) break;
      } catch {}
    }
  }

  const list = picked.slice(0, need);
  const added = list.length ? await add(list) : 0;
  await activity.log('seranking.keywords_added', { details: `${added} keyword(s) added to rank tracking (${tracked.size + added} of ${target} target)` });
  return { tracked: tracked.size + added, target, added, keywords: list, unitsLeft, researchSkipped: !canResearch };
}
