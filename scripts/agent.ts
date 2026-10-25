// Answer the dashboard's Testing mode AI queue from Claude Code, on the owner's subscription instead of
// API credits (lib/aiQueue.ts).
//
//   npx tsx scripts/agent.ts list        waiting jobs, oldest first
//   npx tsx scripts/agent.ts get <id>    saves .agent/<id>/system.md and request.md
//   npx tsx scripts/agent.ts put <id>    sends .agent/<id>/answer.md as the reply
//
// Needs DRAFT_EDIT_TOKEN (same value as on the server, see lib/draftToken.ts; or a network secret that
// adds "Authorization: Bearer <token>") and optionally DASHBOARD_URL (default https://seo.usaindiacfo.us).
// The reply is exactly what the request asks for (often a marked block such as ===JSON=== ... ===END===):
// the dashboard reads it the same way it reads an API answer.
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.DASHBOARD_URL || 'https://seo.usaindiacfo.us').replace(/\/+$/, '');
const TOKEN = process.env.DRAFT_EDIT_TOKEN || '';
const DIR = path.join(process.cwd(), '.agent');

async function api(method: string, p: string, body?: unknown) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error(`${method} ${p}: not signed in. Set DRAFT_EDIT_TOKEN here (same value as on the server).`);
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${json.error || res.statusText}`);
  return json;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'list') {
    const { jobs } = await api('GET', '/api/agent');
    if (!jobs.length) return console.log('No jobs waiting.');
    for (const j of jobs) console.log(`#${j.id}  ${j.created_at}  ${j.feature}${j.web_search ? ' [web]' : ''}  ${String(j.label || '').slice(0, 90)}`);
  } else if (cmd === 'get') {
    const { jobs } = await api('GET', '/api/agent');
    const j = jobs.find((x: any) => x.id === Number(arg));
    if (!j) throw new Error(`No waiting job #${arg}`);
    const dir = path.join(DIR, String(j.id));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'system.md'), j.system);
    const request = [
      `Job #${j.id} (${j.feature}${j.model ? `, written for ${j.model}` : ''})`,
      j.web_search ? 'Web search is allowed and expected: check facts on official sources.' : 'No web search for this one.',
      '',
      ...j.messages.map((m: any) => `===== ${m.role.toUpperCase()} =====\n${m.content}`),
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'request.md'), request);
    console.log(`Wrote ${dir}/system.md and request.md. Put the reply in ${dir}/answer.md, then: npx tsx scripts/agent.ts put ${j.id}`);
  } else if (cmd === 'put') {
    const answer = fs.readFileSync(path.join(DIR, String(Number(arg)), 'answer.md'), 'utf8');
    await api('POST', '/api/agent', { id: Number(arg), answer });
    console.log(`Job #${arg} answered.`);
  } else {
    console.log('Usage: agent.ts list | get <id> | put <id>');
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
