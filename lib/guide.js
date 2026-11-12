// Writes a full, sellable PDF-guide manuscript from a chosen idea, using the
// real questions behind that idea. Tries the free providers first (Gemini, then
// Groq), then Claude. Returns structured content for the PDF renderer.
import { geminiJSON, geminiAvailable, GEMINI_MODEL_NAME } from './ai-gemini.js';
import { groqJSON, groqAvailable, GROQ_MODEL_NAME } from './ai-groq.js';
import { claudeJSON, claudeAvailable, CLAUDE_MODEL_NAME } from './ai-claude.js';

const SYSTEM = `You are a professional non-fiction writer producing a concise, genuinely useful PDF guide that someone would pay for.
Write in clear, warm, practical prose. Be specific and actionable; avoid fluff and filler.
Base the content on the real reader questions provided. Do not invent statistics, prices, or fake studies.
Return JSON with this shape:
{
  "subtitle": string,                // one-line promise under the title
  "intro": [string],                 // 2-3 short paragraphs
  "chapters": [                      // one per outline item (5-8 total)
    { "heading": string, "paragraphs": [string], "tips": [string] }  // 2-4 paragraphs, 2-4 tips
  ],
  "conclusion": [string],            // 1-2 paragraphs
  "cta": string                      // a closing call-to-action line
}`;

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    subtitle: { type: 'STRING' },
    intro: { type: 'ARRAY', items: { type: 'STRING' } },
    chapters: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          heading: { type: 'STRING' },
          paragraphs: { type: 'ARRAY', items: { type: 'STRING' } },
          tips: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['heading', 'paragraphs', 'tips'],
        propertyOrdering: ['heading', 'paragraphs', 'tips'],
      },
    },
    conclusion: { type: 'ARRAY', items: { type: 'STRING' } },
    cta: { type: 'STRING' },
  },
  required: ['subtitle', 'intro', 'chapters', 'conclusion', 'cta'],
};

function buildPrompt(idea) {
  const questions = (idea.exampleQueries || []).map((q) => q.text).slice(0, 12);
  return [
    `Guide title: ${idea.title}`,
    `What it solves: ${idea.description}`,
    `Who it's for: ${idea.audience}`,
    `Planned chapters: ${(idea.outline || []).join('; ')}`,
    `Real questions readers are searching (answer these across the chapters):`,
    ...questions.map((q) => `- ${q}`),
    ``,
    `Write one chapter per planned chapter (or sensible chapters covering the questions). 5-8 chapters total.`,
  ].join('\n');
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const arr = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

function normalize(idea, obj) {
  const chapters = (Array.isArray(obj.chapters) ? obj.chapters : [])
    .map((c) => ({ heading: str(c.heading), paragraphs: arr(c.paragraphs), tips: arr(c.tips) }))
    .filter((c) => c.heading && c.paragraphs.length)
    .slice(0, 8);
  return {
    title: idea.title,
    subtitle: str(obj.subtitle) || idea.description,
    intro: arr(obj.intro),
    chapters,
    conclusion: arr(obj.conclusion),
    cta: str(obj.cta),
    topic: idea.topic,
  };
}

export async function writeGuide(idea) {
  const prompt = buildPrompt(idea);
  const providers = [];
  if (geminiAvailable()) providers.push({ name: GEMINI_MODEL_NAME, run: () => geminiJSON(SYSTEM, prompt, GEMINI_SCHEMA, 16000) });
  if (groqAvailable()) providers.push({ name: GROQ_MODEL_NAME, run: () => groqJSON(SYSTEM, prompt, 16000) });
  if (claudeAvailable()) providers.push({ name: CLAUDE_MODEL_NAME, run: () => claudeJSON(SYSTEM, prompt) });
  if (!providers.length) throw Object.assign(new Error('No AI provider configured — set GEMINI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY to generate guides.'), { status: 400 });

  let lastErr;
  for (const p of providers) {
    try {
      const obj = await p.run();
      const guide = normalize(idea, obj);
      if (!guide.chapters.length) throw new Error('empty guide');
      return { guide, model: p.name };
    } catch (e) {
      lastErr = e;
    }
  }
  throw Object.assign(new Error(`Guide generation failed: ${lastErr?.message || 'unknown'}`), { status: 502 });
}
