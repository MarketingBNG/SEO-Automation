// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
function getKey() {
  const key = process.env.SURFER_API_KEY;
  if (!key) throw new Error('SURFER_API_KEY is not set in .env');
  return key;
}

async function surferFetch(path, opts = {}) {
  const res = await fetch(`https://app.surferseo.com${path}`, {
    signal: AbortSignal.timeout(30000),
    ...opts,
    headers: {
      'API-KEY': getKey(),
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Surfer API error (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

async function listWorkspaces() {
  return surferFetch('/api/v2/workspaces');
}

function getWorkspaceId() {
  const id = process.env.SURFER_WORKSPACE_ID;
  if (!id) throw new Error('SURFER_WORKSPACE_ID is not set in .env');
  return id;
}

// Creates a new Content Editor for a keyword - this consumes one Surfer credit, so this should
// only ever be triggered by an explicit human click, never run automatically.
async function createContentEditor({ mainKeyword, location = 'India - EN' }) {
  const workspaceId = getWorkspaceId();
  return surferFetch(`/api/v2/workspaces/${workspaceId}/content_editors`, {
    method: 'POST',
    body: JSON.stringify({ main_keyword: mainKeyword, location }),
  });
}

async function getContentEditor(id) {
  const workspaceId = getWorkspaceId();
  return surferFetch(`/api/v2/workspaces/${workspaceId}/content_editors/${id}`);
}

async function getTerms(id) {
  const workspaceId = getWorkspaceId();
  return surferFetch(`/api/v2/workspaces/${workspaceId}/content_editors/${id}/seo_guidelines/terms`);
}

// Polls until the Content Editor finishes SERP analysis (usually under a minute), then returns
// the recommended terms to use while writing. One credit total, regardless of how long this
// polling loop takes.
// Each new Content Editor costs a Surfer credit. Its terms for a keyword are kept 7 days, so a blog
// checked again (for example on every publish attempt while it is held) uses the same terms.
async function getTermsForKeyword(mainKeyword, opts: any = {}) {
  const { cachedCall } = await import('./apiCache');
  return cachedCall('surfer-terms', String(mainKeyword || '').toLowerCase().trim(), 24 * 7, () => getTermsForKeywordLive(mainKeyword, opts));
}

// The Content Editor made for a keyword is remembered until its terms are saved, so a check that
// timed out polls the same editor next time instead of paying for a new one. An editor Surfer
// reported as failed blocks a new one for a few hours (a held blog is checked every 15 minutes).
const PENDING_DAYS = 7;
const FAILED_HOURS = 6;

async function getTermsForKeywordLive(mainKeyword, { maxWaitMs = 90000, pollMs = 4000 }: any = {}) {
  const settings = await import('./settings').catch(() => null);
  const key = `surfer-editor:${String(mainKeyword || '').toLowerCase().trim()}`;
  let saved = null;
  try {
    saved = settings ? JSON.parse((await settings.get(key)) || 'null') : null;
  } catch {}
  if (saved?.failedAt && Date.now() - saved.failedAt < FAILED_HOURS * 3600000) {
    throw new Error(`Surfer Content Editor failed for this keyword recently; not tried again until ${FAILED_HOURS} hours have passed`);
  }
  let id;
  let state;
  if (saved?.id && Date.now() - saved.at < PENDING_DAYS * 86400000) {
    id = saved.id;
    state = (await getContentEditor(id)).state;
  } else {
    const editor = await createContentEditor({ mainKeyword });
    id = editor.id;
    state = editor.state;
    if (settings) await settings.set(key, JSON.stringify({ id, at: Date.now() })).catch(() => {});
  }
  const start = Date.now();

  while (state !== 'completed' && state !== 'failed' && Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    const polled = await getContentEditor(id);
    state = polled.state;
  }

  if (state === 'failed' && settings) await settings.set(key, JSON.stringify({ failedAt: Date.now() })).catch(() => {});
  if (state !== 'completed') {
    throw new Error(`Surfer Content Editor did not complete in time (last state: ${state})`);
  }

  const { terms } = await getTerms(id);
  if (settings) await settings.set(key, '').catch(() => {});
  return { editorId: id, terms };
}

export { listWorkspaces, createContentEditor, getContentEditor, getTerms, getTermsForKeyword };
