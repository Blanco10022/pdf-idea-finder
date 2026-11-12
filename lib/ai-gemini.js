// Google Gemini provider (free). Set GEMINI_API_KEY (https://aistudio.google.com/apikey).
import { parseIdeas } from './ai.js';

// 'gemini-flash-latest' is an alias Google keeps on the current stable Flash,
// so this default won't break when a version is retired.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const ENDPOINT = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ideas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          cluster_id: { type: 'STRING' },
          title: { type: 'STRING' },
          description: { type: 'STRING' },
          audience: { type: 'STRING' },
          outline: { type: 'ARRAY', items: { type: 'STRING' } },
          difficulty: { type: 'STRING', enum: ['easy', 'medium', 'hard'] },
        },
        required: ['cluster_id', 'title', 'description', 'audience', 'outline', 'difficulty'],
        propertyOrdering: ['cluster_id', 'title', 'description', 'audience', 'outline', 'difficulty'],
      },
    },
  },
  required: ['ideas'],
};

export function geminiAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function runGemini(system, userPrompt) {
  const obj = await geminiJSON(system, userPrompt, RESPONSE_SCHEMA);
  return { ideas: parseIdeas(obj), model: MODEL };
}

// Generic structured-JSON call (used by both the ideas path and the guide writer).
export async function geminiJSON(system, userPrompt, responseSchema, maxOutputTokens = 8192) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0.7, maxOutputTokens },
  });

  // Gemini occasionally returns 503 (overloaded) or 429; retry once, fast, so a
  // struggling Gemini can't stall the compare (which waits for every provider).
  let res;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(ENDPOINT(MODEL, process.env.GEMINI_API_KEY), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(16000),
        body,
      });
      if (res.status === 503 || res.status === 429) {
        lastErr = new Error(`Gemini: ${res.status}`);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      break;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  if (!res || res.status === 503 || res.status === 429) throw new Error(`Gemini unavailable: ${lastErr?.message || 'overloaded'}`);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      detail = (await res.json())?.error?.message || detail;
    } catch {
      /* non-JSON body */
    }
    throw new Error(`Gemini: ${detail}`);
  }
  const data = await res.json();
  if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked (${data.promptFeedback.blockReason})`);
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  if (!text) throw new Error('Gemini returned empty');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Gemini returned invalid JSON');
  }
}

export const GEMINI_MODEL_NAME = MODEL;
