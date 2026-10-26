// Google Gemini, used only to watch YouTube videos for Learn from YouTube (lib/learning.ts). Gemini is
// Google's official way for an AI to watch a public YouTube video: it sees the frames and hears the
// audio. Needs GEMINI_API_KEY (from aistudio.google.com); GEMINI_MODEL picks the model.
//
// API: POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent with the
// video as a file_data part (file_uri = the YouTube link) and, for a part of a long video,
// video_metadata start_offset / end_offset. Gemini's usage is not Anthropic's: it is not counted in the
// AI credits page.

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const geminiKey = () => process.env.GEMINI_API_KEY || '';
export const geminiModel = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';
// Tried in turn when the configured model is not available to this key.
const FALLBACK_MODELS = ['gemini-2.5-flash'];

export class GeminiError extends Error {
  status: number;
  // The daily free limit or a rate limit: stop for now and carry on later; not the video's fault.
  quota: boolean;
  constructor(message: string, status: number, quota = false) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.quota = quota;
  }
}

async function call(model: string, body: unknown, signal?: AbortSignal) {
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey() },
    body: JSON.stringify(body),
    signal: signal || AbortSignal.timeout(20 * 60 * 1000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const msg = json?.error?.message || String(text).slice(0, 300);
    const quota = res.status === 429 || json?.error?.status === 'RESOURCE_EXHAUSTED';
    throw new GeminiError(`Gemini ${model} (${res.status}): ${msg}`, res.status, quota);
  }
  return json;
}

export type Watched = { text: string; model: string; tokensIn: number; tokensOut: number };

// Watches a public YouTube video (or the part from startSec to endSec) and answers the prompt.
export async function watchVideo({ url, prompt, startSec, endSec, signal }: { url: string; prompt: string; startSec?: number; endSec?: number; signal?: AbortSignal }): Promise<Watched> {
  if (!geminiKey()) throw new GeminiError('GEMINI_API_KEY is not set (Coolify > Environment Variables).', 0);
  const clip = startSec !== undefined && endSec !== undefined;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { file_data: { file_uri: url }, ...(clip ? { video_metadata: { start_offset: `${Math.floor(startSec!)}s`, end_offset: `${Math.ceil(endSec!)}s` } } : {}) },
          { text: prompt },
        ],
      },
    ],
    generationConfig: { temperature: 0.3, maxOutputTokens: 32768 },
  };
  const models = [geminiModel(), ...FALLBACK_MODELS.filter((m) => m !== geminiModel())];
  let lastErr: any;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const json = await call(model, body, signal);
        const cand = json?.candidates?.[0];
        const out = (cand?.content?.parts || []).filter((p: any) => typeof p.text === 'string' && !p.thought).map((p: any) => p.text).join('').trim();
        if (!out) {
          const why = cand?.finishReason || json?.promptFeedback?.blockReason || 'no text';
          throw new GeminiError(`Gemini ${model} returned no notes (${why}).`, 200);
        }
        const u = json?.usageMetadata || {};
        return { text: out, model, tokensIn: u.promptTokenCount || 0, tokensOut: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) };
      } catch (e: any) {
        lastErr = e;
        if (signal?.aborted) throw e;
        // This key cannot use this model: try the next one.
        if (e instanceof GeminiError && (e.status === 404 || (e.status === 400 && /model/i.test(e.message) && /not found|not supported|unknown/i.test(e.message)))) break;
        if (e instanceof GeminiError && e.quota) throw e;
        // Busy or a dropped connection: try again with a growing wait; anything else is final.
        const retry = !(e instanceof GeminiError) || e.status >= 500;
        if (!retry || attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// Settings check: the key works, and whether the configured model is available to it.
export async function testGemini(): Promise<{ ok: boolean; model: string; modelAvailable: boolean; models: string[]; error?: string }> {
  const model = geminiModel();
  if (!geminiKey()) return { ok: false, model, modelAvailable: false, models: [], error: 'GEMINI_API_KEY is not set (Coolify > Environment Variables).' };
  try {
    const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': geminiKey() }, signal: AbortSignal.timeout(20000) });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, model, modelAvailable: false, models: [], error: json?.error?.message || `HTTP ${res.status}` };
    const models = (json?.models || [])
      .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m: any) => String(m.name || '').replace(/^models\//, ''))
      .filter((n: string) => /gemini/i.test(n));
    return { ok: true, model, modelAvailable: models.includes(model), models };
  } catch (e: any) {
    return { ok: false, model, modelAvailable: false, models: [], error: e.message };
  }
}
