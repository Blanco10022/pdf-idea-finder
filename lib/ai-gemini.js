// Google Gemini provider (used when GEMINI_API_KEY is set).
// Uses the free REST API with structured JSON output. No SDK, no card required:
// get a key at https://aistudio.google.com/apikey and set GEMINI_API_KEY.
import { SYSTEM, buildPrompt, collectCopy } from './ai.js';

// 'gemini-flash-latest' is an alias Google keeps pointed at the current stable
// Flash model, so this default won't break when a version is retired.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const ENDPOINT = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

// Gemini wants an OpenAPI-subset schema (uppercase types, no additionalProperties).
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

export async function polishWithGemini({ seedLabel, clusters }) {
  const key = process.env.GEMINI_API_KEY;
  const res = await fetch(ENDPOINT(MODEL, key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: buildPrompt(seedLabel, clusters) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
    }),
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      detail = (await res.json())?.error?.message || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`Gemini API error: ${detail}`);
  }

  const data = await res.json();
  if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request (${data.promptFeedback.blockReason})`);
  const candidate = data.candidates?.[0];
  const finish = candidate?.finishReason;
  if (finish && finish !== 'STOP') throw new Error(`Gemini stopped early (${finish})`);
  const text = candidate?.content?.parts?.map((p) => p.text).join('') || '';
  if (!text) throw new Error('Gemini returned an empty response');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned output that was not valid JSON');
  }
  return { copyById: collectCopy(parsed.ideas, clusters), model: MODEL };
}
