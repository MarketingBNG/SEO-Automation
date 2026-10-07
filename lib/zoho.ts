// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import { getAccessToken } from './zohoAuth';

function getApiBase() {
  const base = process.env.ZOHO_API_BASE_URL;
  if (!base) throw new Error('ZOHO_API_BASE_URL is not set in .env');
  return base;
}

async function zohoGet(path) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Zoho API error (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

// Confirms the connection and returns basic org info.
async function testConnection() {
  const json = await zohoGet('/crm/v2/org');
  return json.org?.[0];
}

// Counts by module - a lightweight pipeline snapshot (lead -> deal chain from the playbook).
async function getPipelineSummary() {
  const [leads, deals] = await Promise.all([
    zohoGet('/crm/v2/Leads?fields=Lead_Status&per_page=200').catch((e: any) => ({ error: e.message })),
    zohoGet('/crm/v2/Deals?fields=Stage,Amount&per_page=200').catch((e: any) => ({ error: e.message })),
  ]);

  const leadsByStatus: any = {};
  for (const l of leads.data || []) {
    const status = l.Lead_Status || 'Unknown';
    leadsByStatus[status] = (leadsByStatus[status] || 0) + 1;
  }

  const dealsByStage: any = {};
  let totalDealValue = 0;
  for (const d of deals.data || []) {
    const stage = d.Stage || 'Unknown';
    dealsByStage[stage] = (dealsByStage[stage] || 0) + 1;
    totalDealValue += Number(d.Amount || 0);
  }

  return {
    leadsByStatus,
    dealsByStage,
    totalDealValue,
    leadsError: leads.error,
    dealsError: deals.error,
  };
}

// Pulls every lead's source and conversion status, and groups by source - so you can see, e.g.,
// how many leads came from "Website"/"Blog" vs. other channels, and what fraction of each
// actually converted (Zoho marks a lead Converted when it becomes a Contact + Deal).
async function getLeadSourceBreakdown() {
  const perPage = 200;
  const maxPages = 5; // caps at 1000 leads per call to keep this fast and cheap
  let allLeads: any[] = [];

  for (let page = 1; page <= maxPages; page++) {
    let json: any;
    try {
      json = await zohoGet(
        `/crm/v2/Leads?fields=Lead_Source,Converted,Lead_Status,Created_Time&per_page=${perPage}&page=${page}`
      );
    } catch (e: any) {
      if (page === 1) throw e;
      break; // ran out of pages / hit a rate limit after getting some data - use what we have
    }
    const batch = json.data || [];
    allLeads = allLeads.concat(batch);
    if (!json.info?.more_records) break;
  }

  const bySource: any = {};
  for (const lead of allLeads) {
    const source = lead.Lead_Source || 'Not set';
    if (!bySource[source]) bySource[source] = { total: 0, converted: 0 };
    bySource[source].total++;
    if (lead.Converted) bySource[source].converted++;
  }

  const rows = Object.entries(bySource)
    .map(([source, stats]) => ({
      source,
      total: stats.total,
      converted: stats.converted,
      conversionRate: stats.total ? stats.converted / stats.total : 0,
      isBlogLike: /blog|organic|content|seo/i.test(source),
    }))
    .sort((a, b) => b.total - a.total);

  const totalLeads = allLeads.length;
  const totalConverted = allLeads.filter((l) => l.Converted).length;

  return {
    totalLeads,
    totalConverted,
    overallConversionRate: totalLeads ? totalConverted / totalLeads : 0,
    bySource: rows,
    truncated: allLeads.length >= perPage * maxPages,
  };
}

export { testConnection, getPipelineSummary, getLeadSourceBreakdown, zohoGet };
