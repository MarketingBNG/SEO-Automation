// @ts-nocheck -- reads untyped Zoho records.
// K12 / T2: business results by blog topic. Which blog (and which service) each organic lead came
// from, how many became consults and how many signed, read from Zoho CRM.
//
// Attribution comes from fields on the lead or deal that carry the page or the UTM tags: Zoho's own
// visitor-tracking fields (First Visited URL, Referrer), or UTM / landing-page fields that the
// website forms, Calendly and WhatsApp fill (see TRACKING_SNIPPET). The fields are found by name, so
// no setup in the dashboard is needed once Zoho has them.
import prisma from './prisma';
import * as settings from './settings';
import { zohoGet } from './zoho';
import { DEFAULT_CTAS, pickCta } from './strategy/core';

const TRACK_FIELD = /utm|landing|first.?visit|referr|source.?url|page.?url|campaign/i;
const CONSULT = /consult|meeting|call (?:booked|done|scheduled)|qualified|contacted|proposal|discovery|demo|negotiat/i;
const SIGNED = /closed.?won|\bwon\b|signed|onboard|engaged|retainer|paid/i;

async function trackingFields(module) {
  const json = await zohoGet(`/crm/v2/settings/fields?module=${module}`);
  return (json.fields || []).filter((f) => TRACK_FIELD.test(`${f.api_name} ${f.field_label}`)).map((f) => ({ api: f.api_name, label: f.field_label }));
}

async function allRecords(module, fields, max = 1000) {
  const out = [];
  for (let page = 1; page <= Math.ceil(max / 200); page++) {
    let json;
    try {
      json = await zohoGet(`/crm/v2/${module}?fields=${encodeURIComponent(fields.join(','))}&per_page=200&page=${page}`);
    } catch (e) {
      if (page === 1) throw e;
      break;
    }
    out.push(...(json.data || []));
    if (!json.info?.more_records) break;
  }
  return out;
}

const pathOf = (u) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return null;
  }
};

// The blog a lead came from: a usaindiacfo.com page in any tracking field, or our utm_campaign.
function attribute(rec, fields, posts) {
  const values = fields.map((f) => String(rec[f.api] || '')).filter(Boolean);
  for (const v of values) {
    for (const m of v.matchAll(/https?:\/\/[^\s"']+/g)) {
      const url = m[0];
      if (!/usaindiacfo\.com/i.test(url)) continue;
      const camp = new URL(url).searchParams.get('utm_campaign');
      if (camp && posts.byCampaign.has(camp)) return posts.byCampaign.get(camp);
      const p = pathOf(url);
      if (p && posts.byPath.has(p)) return posts.byPath.get(p);
      if (p && p !== '/') return { title: p, url, keyword: p.split('/').pop().replace(/-/g, ' ') };
    }
    const camp = (v.match(/utm_campaign=([^&\s]+)/) || [])[1] || (/^[a-z0-9-]{6,}$/.test(v) ? v : null);
    if (camp && posts.byCampaign.has(camp)) return posts.byCampaign.get(camp);
  }
  return null;
}

export async function businessResults({ days = 90 } = {}) {
  const since = new Date(Date.now() - days * 86400000);
  // Our published posts: by path and by the utm_campaign slug the CTA links carry.
  const rows = await prisma.blog_schedule.findMany({ where: { wp_post_url: { not: null } }, select: { title: true, main_keyword: true, wp_post_url: true } });
  const drafts = await prisma.drafts.findMany({ where: { wp_post_url: { not: null } }, select: { title: true, wp_post_url: true, keyword: { select: { keyword: true } } } });
  const posts = { byPath: new Map(), byCampaign: new Map() };
  for (const r of [...rows.map((r) => ({ title: r.title, keyword: r.main_keyword, url: r.wp_post_url })), ...drafts.map((d) => ({ title: d.title, keyword: d.keyword?.keyword || d.title, url: d.wp_post_url }))]) {
    const p = pathOf(r.url);
    if (p) posts.byPath.set(p, r);
    posts.byCampaign.set(String(r.keyword).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60), r);
  }
  let ctas = DEFAULT_CTAS;
  try {
    const c = JSON.parse((await settings.get('service_ctas')) || '[]');
    if (Array.isArray(c) && c.length) ctas = c;
  } catch {}

  const [leadFields, dealFields] = await Promise.all([trackingFields('Leads'), trackingFields('Deals')]);
  const leads = await allRecords('Leads', ['Lead_Source', 'Lead_Status', 'Created_Time', 'Full_Name', ...leadFields.map((f) => f.api)]);
  const deals = await allRecords('Deals', ['Stage', 'Amount', 'Created_Time', 'Lead_Source', 'Deal_Name', ...dealFields.map((f) => f.api)]);

  const inWindow = (r) => !r.Created_Time || new Date(r.Created_Time) >= since;
  const byTopic = new Map();
  const bump = (post, kind, amount = 0) => {
    const key = post?.url || '(not tracked)';
    if (!byTopic.has(key)) byTopic.set(key, { title: post?.title || 'Source page not recorded', url: post?.url || null, service: post ? pickCta(ctas, post.keyword, post.title)?.service || 'Other' : '-', leads: 0, consults: 0, signed: 0, value: 0 });
    const t = byTopic.get(key);
    t[kind]++;
    t.value += kind === 'signed' ? Number(amount || 0) : 0;
  };

  let organic = 0;
  for (const l of leads.filter(inWindow)) {
    const post = attribute(l, leadFields, posts);
    const fromWeb = post || /blog|organic|seo|website|google/i.test(l.Lead_Source || '');
    if (!fromWeb) continue;
    organic++;
    bump(post, 'leads');
    if (CONSULT.test(l.Lead_Status || '')) bump(post, 'consults');
  }
  // Converted leads become deals: every deal from the web counts as a consult; won deals as signed.
  for (const d of deals.filter(inWindow)) {
    const post = attribute(d, dealFields, posts);
    if (!post && !/blog|organic|seo|website|google/i.test(d.Lead_Source || '')) continue;
    bump(post, 'consults');
    if (SIGNED.test(d.Stage || '')) bump(post, 'signed', d.Amount);
  }

  const topics = [...byTopic.values()].sort((a, b) => b.signed - a.signed || b.consults - a.consults || b.leads - a.leads);
  const services = new Map();
  for (const t of topics.filter((x) => x.url)) {
    const s = services.get(t.service) || { service: t.service, leads: 0, consults: 0, signed: 0, value: 0 };
    for (const k of ['leads', 'consults', 'signed', 'value']) s[k] += t[k];
    services.set(t.service, s);
  }
  const totals = topics.reduce((a, t) => ({ leads: a.leads + t.leads, consults: a.consults + t.consults, signed: a.signed + t.signed, value: a.value + t.value }), { leads: 0, consults: 0, signed: 0, value: 0 });
  const tracked = topics.filter((t) => t.url).reduce((n, t) => n + t.leads + t.consults, 0);
  return {
    days,
    totals,
    organicLeads: organic,
    trackedShare: totals.leads + totals.consults ? Math.round((tracked / (totals.leads + totals.consults)) * 100) : 0,
    topics,
    services: [...services.values()].sort((a, b) => b.signed - a.signed || b.consults - a.consults),
    trackingFields: { leads: leadFields.map((f) => f.label), deals: dealFields.map((f) => f.label) },
    setupNeeded: !leadFields.length && !dealFields.length,
  };
}

// Paste once into the website (WordPress > WPCode or the theme's footer). It remembers the first
// page and UTM tags of a visit, fills hidden fields on every form, passes the tags to Calendly links
// and adds the page to WhatsApp messages, so Zoho records where each lead came from.
export const TRACKING_SNIPPET = `<script>
(function () {
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var q = new URLSearchParams(location.search), t = {};
  try { t = JSON.parse(localStorage.getItem('uic_first_touch') || '{}'); } catch (e) {}
  if (!t.landing_page || q.get('utm_source')) {
    t = { landing_page: location.href.split('#')[0], referrer: document.referrer || '' };
    KEYS.forEach(function (k) { if (q.get(k)) t[k] = q.get(k); });
    try { localStorage.setItem('uic_first_touch', JSON.stringify(t)); } catch (e) {}
  }
  t.lead_page = location.href.split('#')[0];
  function fill(form) {
    Object.keys(t).forEach(function (k) {
      var el = form.querySelector('[name="' + k + '"]');
      if (!el) { el = document.createElement('input'); el.type = 'hidden'; el.name = k; form.appendChild(el); }
      el.value = t[k];
    });
  }
  document.addEventListener('submit', function (e) { if (e.target && e.target.tagName === 'FORM') fill(e.target); }, true);
  document.querySelectorAll('form').forEach(fill);
  document.querySelectorAll('a[href*="calendly.com"]').forEach(function (a) {
    var u = new URL(a.href);
    KEYS.forEach(function (k) { if (t[k]) u.searchParams.set(k, t[k]); });
    if (!u.searchParams.get('utm_source')) { u.searchParams.set('utm_source', 'website'); u.searchParams.set('utm_content', location.pathname); }
    a.href = u.toString();
  });
  document.querySelectorAll('a[href*="wa.me"], a[href*="api.whatsapp.com"]').forEach(function (a) {
    var u = new URL(a.href);
    u.searchParams.set('text', (u.searchParams.get('text') || 'Hi, I have a question.') + ' (Page: ' + location.pathname + ')');
    a.href = u.toString();
  });
})();
</script>`;
