// Optional AI polish. Two providers, auto-selected by which key is present:
//   GEMINI_API_KEY     -> Google Gemini (free tier, your own key)
//   ANTHROPIC_API_KEY  -> Claude
// The model only rewrites each idea's title/description/audience/outline from
// that cluster's real queries. It never produces numbers: every score in the UI
// comes from the observed search data, not the model.
import { polishWithClaude, claudeAvailable } from './ai-claude.js';
import { polishWithGemini, geminiAvailable } from './ai-gemini.js';

// Shared instruction + the exact fields we want back, so both providers agree.
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

export function buildPrompt(seedLabel, clusters) {
  const payload = clusters.map((c) => ({
    cluster_id: c.id,
    sub_topic: c.topic,
    queries: c.queries.slice(0, 12).map((q) => q.text),
  }));
  return `Main topic: ${seedLabel}\n\nClusters (real autocomplete queries):\n${JSON.stringify(payload, null, 1)}`;
}

// Keep only ideas that map to a real cluster, and strip the cluster_id key.
export function collectCopy(ideas, clusters) {
  const known = new Set(clusters.map((c) => c.id));
  const copyById = {};
  for (const idea of ideas || []) {
    if (!known.has(idea.cluster_id)) continue;
    const { cluster_id, ...copy } = idea;
    copyById[cluster_id] = copy;
  }
  return copyById;
}

export function activeProvider() {
  if (geminiAvailable()) return 'gemini';
  if (claudeAvailable()) return 'claude';
  return null;
}

export function aiEnabled() {
  return activeProvider() !== null;
}

export async function polish(args) {
  const provider = activeProvider();
  if (provider === 'gemini') return polishWithGemini(args);
  if (provider === 'claude') return polishWithClaude(args);
  throw new Error('No AI provider configured');
}
