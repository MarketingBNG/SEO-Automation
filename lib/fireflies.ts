// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
const API_URL = 'https://api.fireflies.ai/graphql';

function getApiKey() {
  const key = process.env.FIREFLIES_API_KEY;
  if (!key) throw new Error('FIREFLIES_API_KEY is not set in .env');
  return key;
}

async function graphql(query, variables) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    const message = json.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Fireflies API error: ${message}`);
  }
  return json.data;
}

// Confirms the API key works by fetching the account's own user info.
async function testConnection() {
  const data = await graphql(`query { user { user_id name email } }`);
  return data.user;
}

// Recent meeting transcripts with AI-generated summaries - the source of real client
// language, common questions, and deal context for the Revenue/Admin module.
async function getRecentTranscripts(limit = 10) {
  const data = await graphql(
    `query Transcripts($limit: Int) {
      transcripts(limit: $limit) {
        id
        title
        date
        duration
        participants
        summary {
          overview
          action_items
          keywords
          short_summary
        }
      }
    }`,
    { limit }
  );
  return data.transcripts || [];
}

export { testConnection, getRecentTranscripts };
