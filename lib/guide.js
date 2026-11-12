// Writes a commercial-grade PDF-guide manuscript from a chosen idea, structured
// the way guides that actually sell are: a named framework, concrete examples,
// common-mistake warnings, do-this-now actions, a worksheet, and an FAQ built
// from the real reader questions. Tries free providers first (Gemini, Groq),
// then Claude. Returns structured content for the PDF renderer.
import { geminiJSON, geminiAvailable, GEMINI_MODEL_NAME } from './ai-gemini.js';
import { groqJSON, groqAvailable, GROQ_MODEL_NAME } from './ai-groq.js';
import { claudeJSON, claudeAvailable, CLAUDE_MODEL_NAME } from './ai-claude.js';

const SYSTEM = `You are a professional writer and info-product creator. You produce concise, premium PDF guides that people pay for and actually finish.

Write like a bestselling how-to guide, NOT like a generic AI article. Rules:
- Teach a single clear transformation ("one problem, one solution").
- Build the guide around a NAMED framework or method (e.g. "The 3-Light System") so it feels proprietary and systematic.
- Be specific and concrete: real examples, sample scripts, exact steps, numbers. Never vague filler, never invented statistics or fake studies.
- Keep prose tight and scannable: short paragraphs, plain language, active voice.
- Answer the real reader questions provided, woven into the chapters and the FAQ.
- Each chapter should give the reader something to DO.

Return JSON of exactly this shape:
{
  "promise": string,                 // the transformation the reader gets, 1-2 sentences
  "reader": string,                  // who this is for, one sentence
  "framework": { "name": string, "steps": [string] },   // the named method, 3-6 steps
  "chapters": [                      // 6-10 chapters, each actionable
    {
      "heading": string,
      "intro": [string],             // 1-2 short paragraphs
      "steps": [string],             // concrete steps or key points (3-6), [] if not applicable
      "example": string,             // a short worked example, script, or sample ("" if none)
      "mistake": string,             // one common mistake to avoid ("" if none)
      "action": string               // one do-this-now action ("" if none)
    }
  ],
  "checklist": [string],             // 6-10 action-plan items for a worksheet page
  "faq": [ { "q": string, "a": string } ],   // 4-6, from the real questions
  "resources": [string],             // 3-5 next steps / tools / where to go further
  "cta": string                      // closing call-to-action line
}`;

const chapterSchema = {
  type: 'OBJECT',
  properties: {
    heading: { type: 'STRING' },
    intro: { type: 'ARRAY', items: { type: 'STRING' } },
    steps: { type: 'ARRAY', items: { type: 'STRING' } },
    example: { type: 'STRING' },
    mistake: { type: 'STRING' },
    action: { type: 'STRING' },
  },
  required: ['heading', 'intro', 'steps', 'example', 'mistake', 'action'],
  propertyOrdering: ['heading', 'intro', 'steps', 'example', 'mistake', 'action'],
};

const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    promise: { type: 'STRING' },
    reader: { type: 'STRING' },
    framework: {
      type: 'OBJECT',
      properties: { name: { type: 'STRING' }, steps: { type: 'ARRAY', items: { type: 'STRING' } } },
      required: ['name', 'steps'],
      propertyOrdering: ['name', 'steps'],
    },
    chapters: { type: 'ARRAY', items: chapterSchema },
    checklist: { type: 'ARRAY', items: { type: 'STRING' } },
    faq: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { q: { type: 'STRING' }, a: { type: 'STRING' } }, required: ['q', 'a'], propertyOrdering: ['q', 'a'] },
    },
    resources: { type: 'ARRAY', items: { type: 'STRING' } },
    cta: { type: 'STRING' },
  },
  required: ['promise', 'reader', 'framework', 'chapters', 'checklist', 'faq', 'resources', 'cta'],
};

function buildPrompt(idea) {
  const questions = (idea.exampleQueries || []).map((q) => q.text).slice(0, 14);
  return [
    `Guide title: ${idea.title}`,
    `What it solves: ${idea.description}`,
    `Who it's for: ${idea.audience}`,
    `Planned chapters: ${(idea.outline || []).join('; ')}`,
    `Real reader questions (answer these across chapters and the FAQ):`,
    ...questions.map((q) => `- ${q}`),
    ``,
    `Write a complete, sellable guide. Invent a memorable name for the framework. Make every chapter actionable.`,
  ].join('\n');
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const arr = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

function normalize(idea, obj) {
  const chapters = (Array.isArray(obj.chapters) ? obj.chapters : [])
    .map((c) => ({
      heading: str(c.heading).replace(/^\s*(chapter\s*)?\d+\s*[.):-]\s*/i, ''), // drop model's own "1." prefix

      intro: arr(c.intro),
      steps: arr(c.steps),
      example: str(c.example),
      mistake: str(c.mistake),
      action: str(c.action),
    }))
    .filter((c) => c.heading && (c.intro.length || c.steps.length))
    .slice(0, 12);
  const fw = obj.framework || {};
  return {
    title: idea.title,
    promise: str(obj.promise) || idea.description,
    reader: str(obj.reader) || idea.audience,
    framework: { name: str(fw.name), steps: arr(fw.steps) },
    chapters,
    checklist: arr(obj.checklist),
    faq: (Array.isArray(obj.faq) ? obj.faq : []).map((f) => ({ q: str(f.q), a: str(f.a) })).filter((f) => f.q && f.a).slice(0, 8),
    resources: arr(obj.resources),
    cta: str(obj.cta),
    topic: idea.topic,
  };
}

export async function writeGuide(idea) {
  const prompt = buildPrompt(idea);
  const providers = [];
  if (geminiAvailable()) providers.push({ name: GEMINI_MODEL_NAME, run: () => geminiJSON(SYSTEM, prompt, GEMINI_SCHEMA, 20000) });
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
