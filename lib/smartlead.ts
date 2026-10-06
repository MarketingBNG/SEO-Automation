// Smartlead API client (https://server.smartlead.ai/api/v1). The key is read from SMARTLEAD_API_KEY and
// passed as the api_key query parameter, as Smartlead requires; it is never logged and is removed from
// any error message.
const BASE = 'https://server.smartlead.ai/api/v1';

export const smartleadConfigured = () => Boolean(process.env.SMARTLEAD_API_KEY && process.env.SMARTLEAD_CAMPAIGN_ID);

function redact(text: string) {
  const key = process.env.SMARTLEAD_API_KEY;
  return key ? text.split(key).join('[key hidden]') : text;
}

async function call(method: string, path: string, { query = {}, body }: { query?: Record<string, string>; body?: any } = {}) {
  const key = process.env.SMARTLEAD_API_KEY;
  if (!key) throw new Error('SMARTLEAD_API_KEY is not set');
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { ok: res.ok, status: res.status, json, text: redact(String(text).slice(0, 300)) };
  } catch (e: any) {
    throw new Error(`Smartlead ${method} ${path} failed: ${redact(String(e.message || e))}`);
  } finally {
    clearTimeout(t);
  }
}

// True when Smartlead already has this email as a lead (in any campaign).
export async function leadExists(email: string): Promise<boolean> {
  const r = await call('GET', '/leads/', { query: { email } });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`Smartlead lead lookup failed (${r.status}): ${r.text}`);
  return Boolean(r.json && typeof r.json === 'object' && (r.json.id || r.json.email));
}

export type Lead = {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  website?: string;
  custom_fields?: Record<string, string>;
};

// Adds one lead to the outreach campaign. Smartlead's own block, unsubscribe and duplicate lists stay on.
export async function addLead(lead: Lead) {
  const campaign = process.env.SMARTLEAD_CAMPAIGN_ID;
  if (!campaign) throw new Error('SMARTLEAD_CAMPAIGN_ID is not set');
  const r = await call('POST', `/campaigns/${encodeURIComponent(campaign)}/leads`, {
    body: {
      lead_list: [lead],
      settings: { ignore_global_block_list: false, ignore_unsubscribe_list: false, ignore_duplicate_leads_in_other_campaign: false },
    },
  });
  if (!r.ok) throw new Error(`Smartlead add lead failed (${r.status}): ${r.text}`);
  return r.json;
}
