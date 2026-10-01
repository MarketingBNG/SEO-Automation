// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
function getKey() {
  const key = process.env.SURFER_API_KEY;
  if (!key) throw new Error('SURFER_API_KEY is not set in .env');
  return key;
}

async function surferFetch(path, opts = {}) {
  const res = await fetch(`https://app.surferseo.com${path}`, {
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
async function getTermsForKeyword(mainKeyword, { maxWaitMs = 90000, pollMs = 4000 }: any = {}) {
  const editor = await createContentEditor({ mainKeyword });
  const start = Date.now();
  let state = editor.state;
  const id = editor.id;

  while (state !== 'completed' && state !== 'failed' && Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    const polled = await getContentEditor(id);
    state = polled.state;
  }

  if (state !== 'completed') {
    throw new Error(`Surfer Content Editor did not complete in time (last state: ${state})`);
  }

  const { terms } = await getTerms(id);
  return { editorId: id, terms };
}

export { listWorkspaces, createContentEditor, getContentEditor, getTerms, getTermsForKeyword };
