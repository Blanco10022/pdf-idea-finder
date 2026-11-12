// Groq provider (free, fast). Set GROQ_API_KEY (https://console.groq.com/keys).
// OpenAI-compatible chat completions with JSON mode.
import { parseIdeas } from './ai.js';

const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export function groqAvailable() {
  return Boolean(process.env.GROQ_API_KEY);
}

export async function runGroq(system, userPrompt) {
  const obj = await groqJSON(
    `${system}\n\nReturn JSON of the form: {"ideas":[{"cluster_id","title","description","audience","outline":[...],"difficulty":"easy|medium|hard"}]}`,
    userPrompt,
  );
  return { ideas: parseIdeas(obj), model: MODEL };
}

// Generic JSON-mode call (used by the ideas path and the guide writer).
export async function groqJSON(system, userPrompt, maxTokens = 8000) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      detail = (await res.json())?.error?.message || detail;
    } catch {
      /* non-JSON body */
    }
    throw new Error(`Groq: ${detail}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) throw new Error('Groq returned empty');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('Groq returned invalid JSON');
  }
}

export const GROQ_MODEL_NAME = MODEL;
