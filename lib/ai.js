// AI polish orchestrator. Providers self-activate by key:
//   GEMINI_API_KEY     -> Google Gemini (free)
//   GROQ_API_KEY       -> Groq (free, fast Llama)
//   ANTHROPIC_API_KEY  -> Claude (paid)
// With one provider, it just writes the copy. With two or more, it runs them in
// parallel and a judge model picks/merges the best idea per cluster ("compare +
// pick best"). The model never produces numbers; every score comes from data.
import { runGemini, geminiAvailable } from './ai-gemini.js';
import { runGroq, groqAvailable } from './ai-groq.js';
import { runClaude, claudeAvailable } from './ai-claude.js';

export const SYSTEM = `You turn clusters of real search queries into sellable PDF guide ideas.
Rules:
- Write exactly one idea per cluster, keyed by its cluster_id.
- Base each idea strictly on that cluster's queries; do not invent unrelated topics.
- title: specific and benefit-driven, under 80 characters.
- description: one sentence on what the guide solves.
- audience: who is searching, one short sentence.
- outline: 5 to 7 chapter titles, each answering one or more of the cluster's queries.
- difficulty: how hard the guide would be to write well (easy / medium / hard).
- Never state search volumes, prices or statistics.`;

const JUDGE_SYSTEM = `You are choosing the best PDF guide idea for each cluster.
For each cluster you get its real search queries and two or more candidate ideas from different AI models.
For each cluster_id, output the single best idea: pick the strongest candidate or merge their best parts.
Keep it faithful to that cluster's queries. Same field rules as the candidates. Never state numbers or statistics.`;

export function buildPrompt(seedLabel, clusters) {
  const payload = clusters.map((c) => ({
    cluster_id: c.id,
    sub_topic: c.topic,
    queries: c.queries.slice(0, 12).map((q) => q.text),
  }));
  return `Main topic: ${seedLabel}\n\nClusters (real queries):\n${JSON.stringify(payload, null, 1)}`;
}

function buildJudgePrompt(seedLabel, clusters, candidateSets) {
  const payload = clusters.map((c) => ({
    cluster_id: c.id,
    queries: c.queries.slice(0, 10).map((q) => q.text),
    candidates: candidateSets
      .map((set) => set.copyById[c.id] && { model: set.name, ...set.copyById[c.id] })
      .filter(Boolean),
  }));
  return `Main topic: ${seedLabel}\n\nFor each cluster, pick or merge the best candidate:\n${JSON.stringify(payload, null, 1)}`;
}

// Keep only ideas mapping to a real cluster; strip cluster_id.
export function collectCopy(ideas, clusters) {
  const known = new Set(clusters.map((c) => c.id));
  const copyById = {};
  for (const idea of ideas || []) {
    if (idea && known.has(idea.cluster_id)) {
      const { cluster_id, ...copy } = idea;
      copyById[cluster_id] = copy;
    }
  }
  return copyById;
}

// Lenient validation of a model's JSON (used by the JSON-mode provider).
export function parseIdeas(obj) {
  const ideas = Array.isArray(obj?.ideas) ? obj.ideas : [];
  return ideas
    .filter((i) => i && typeof i.cluster_id === 'string' && typeof i.title === 'string')
    .map((i) => ({
      cluster_id: i.cluster_id,
      title: String(i.title),
      description: String(i.description || ''),
      audience: String(i.audience || ''),
      outline: Array.isArray(i.outline) ? i.outline.map(String) : [],
      difficulty: ['easy', 'medium', 'hard'].includes(i.difficulty) ? i.difficulty : 'medium',
    }));
}

// Providers in preference order (most capable first for judging).
function providers() {
  return [
    { name: 'claude', run: runClaude, available: claudeAvailable() },
    { name: 'gemini', run: runGemini, available: geminiAvailable() },
    { name: 'groq', run: runGroq, available: groqAvailable() },
  ].filter((p) => p.available);
}

export function activeProviders() {
  return providers().map((p) => p.name);
}
export function aiEnabled() {
  return providers().length > 0;
}

export async function polish({ seedLabel, clusters }) {
  const avail = providers();
  if (!avail.length) throw new Error('No AI provider configured');

  // Single provider: just write the copy.
  if (avail.length === 1) {
    const r = await avail[0].run(SYSTEM, buildPrompt(seedLabel, clusters));
    return { copyById: collectCopy(r.ideas, clusters), model: r.model };
  }

  // Multiple providers: run in parallel, then judge/merge.
  const settled = await Promise.allSettled(avail.map((p) => p.run(SYSTEM, buildPrompt(seedLabel, clusters))));
  const ok = settled
    .map((s, i) => (s.status === 'fulfilled' ? { name: avail[i].name, model: s.value.model, copyById: collectCopy(s.value.ideas, clusters) } : null))
    .filter(Boolean);

  if (!ok.length) throw new Error(settled.find((s) => s.status === 'rejected')?.reason?.message || 'All AI providers failed');
  if (ok.length === 1) return { copyById: ok[0].copyById, model: ok[0].model };

  // Judge with the most capable available provider.
  const judge = avail[0];
  try {
    const j = await judge.run(JUDGE_SYSTEM, buildJudgePrompt(seedLabel, clusters, ok));
    return {
      copyById: collectCopy(j.ideas, clusters),
      model: `compare(${ok.map((o) => o.name).join('+')}) → judge:${judge.name}`,
      judged: true,
    };
  } catch {
    // Judge failed: fall back to the first successful candidate set.
    return { copyById: ok[0].copyById, model: `${ok[0].model} (judge unavailable)` };
  }
}
