import { suggest, pool, wikipediaTrend, ENGINES } from './sources.js';

export const NICHES = {
  Parenting: ['toddler', 'newborn baby', 'teenager'],
  Fitness: ['home workout', 'weight loss', 'strength training'],
  Money: ['budget', 'save money', 'credit score'],
  Relationships: ['marriage', 'dating', 'breakup'],
  Pets: ['puppy', 'cat', 'dog training'],
  Lifestyle: ['minimalism', 'meal prep', 'home organization'],
  Career: ['job interview', 'resume', 'career change'],
  Health: ['sleep', 'anxiety', 'gut health'],
  Business: ['small business', 'side hustle', 'etsy shop'],
  Technology: ['chatgpt', 'smartphone', 'home wifi'],
  'Self-Improvement': ['productivity', 'habits', 'confidence'],
  Other: [],
};

// Question-style and problem-style modifiers. Autocomplete returns the most
// popular completions for each, which is how we surface what people ask.
const GOOGLE_TEMPLATES = [
  (s) => `how to ${s}`,
  (s) => `how do i ${s}`,
  (s) => `why ${s}`,
  (s) => `what ${s}`,
  (s) => `can ${s}`,
  (s) => `${s} for beginners`,
  (s) => `${s} tips`,
  (s) => `${s} help`,
  (s) => `${s} problems`,
  (s) => `${s} mistakes`,
  (s) => `${s} guide`,
  (s) => `${s} plan`,
  (s) => `best way to ${s}`,
  (s) => `${s} without`,
  (s) => `${s} when`,
  (s) => `${s}`,
  ...'abcdefghilmnprstw'.split('').map((l) => (s) => `${s} ${l}`),
];
const OTHER_ENGINE_TEMPLATES = [
  (s) => `how to ${s}`,
  (s) => `${s}`,
  (s) => `${s} tips`,
  (s) => `${s} for beginners`,
  (s) => `why ${s}`,
  (s) => `${s} mistakes`,
];
const ENGINE_WEIGHT = { google: 1, youtube: 0.8, duckduckgo: 0.6 };

const STOPWORDS = new Set(
  ('a an the and or but if of to in on at by for from with without into over under about as is are was were be been ' +
    'do does did doing done i me my mine you your yours we our it its this that these those there here what which who whom ' +
    'why when where how can could should would will shall may might must not no yes vs versus best good better way ways ' +
    'get got make made use using need needs want really very so too much many more most near me online free 2024 2025 2026 2027 ' +
    'tips help guide beginners beginner reddit youtube video videos pdf book books meaning definition')
    .split(' '),
);
const QUESTION_START = /^(how|why|what|when|where|which|who|can|could|should|is|are|do|does|did|will|would)\b/;

function words(q) {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
function titleCase(s) {
  const small = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'vs', 'at', 'by']);
  return s
    .split(' ')
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// Step 1: collect real queries from autocomplete for every seed.
async function collectQueries(seeds, lang) {
  const jobs = [];
  for (const seed of seeds) {
    for (const t of GOOGLE_TEMPLATES) jobs.push({ engine: 'google', prompt: t(seed), seed });
    for (const engine of ['youtube', 'duckduckgo'])
      for (const t of OTHER_ENGINE_TEMPLATES) jobs.push({ engine, prompt: t(seed), seed });
  }

  const results = await pool(jobs, 8, (j) => suggest(j.engine, j.prompt, lang));
  const queries = new Map(); // text -> record
  const engineStats = Object.fromEntries(Object.keys(ENGINES).map((e) => [e, { requests: 0, failed: 0 }]));

  results.forEach((r, i) => {
    const job = jobs[i];
    engineStats[job.engine].requests++;
    if (!r.ok) {
      engineStats[job.engine].failed++;
      return;
    }
    r.value.forEach((text, rank) => {
      if (text.split(' ').length < 2) return;
      const rec = queries.get(text) || { text, seed: job.seed, hits: 0, demand: 0, engines: new Set() };
      rec.hits++;
      rec.engines.add(job.engine);
      // Earlier autocomplete positions are more popular completions.
      rec.demand += ENGINE_WEIGHT[job.engine] * (1 - rank / 12);
      queries.set(text, rec);
    });
  });
  return { queries: [...queries.values()], engineStats, requestCount: jobs.length };
}

// Step 2: group queries into idea clusters around shared sub-topics.
function clusterQueries(queries, seeds, maxClusters) {
  const seedTokens = seeds.flatMap((s) => words(s).map(stem));
  // "budget" and "budgeting" share a root, so both count as the seed, not as a sub-topic.
  const isSeed = (w) => seedTokens.some((s) => w === s || (s.length >= 5 && w.length >= 5 && w.slice(0, 5) === s.slice(0, 5)));
  const keysOf = (q) => {
    const toks = words(q.text)
      .map(stem)
      .filter((w) => !STOPWORDS.has(w) && !STOPWORDS.has(w + 's') && !isSeed(w) && w.length > 2 && !/^\d+$/.test(w));
    const keys = new Set(toks);
    for (let i = 0; i < toks.length - 1; i++) keys.add(`${toks[i]} ${toks[i + 1]}`);
    return keys;
  };
  const items = queries.map((q) => ({ q, keys: keysOf(q), used: false }));

  const clusters = [];
  while (clusters.length < maxClusters) {
    const weight = new Map();
    for (const it of items) {
      if (it.used) continue;
      for (const k of it.keys) weight.set(k, (weight.get(k) || 0) + it.q.demand + 0.5);
    }
    let bestKey = null;
    let bestScore = 0;
    for (const [k, w] of weight) {
      const members = items.filter((it) => !it.used && it.keys.has(k)).length;
      if (members < 2) continue;
      const score = w * (k.includes(' ') ? 1.35 : 1); // prefer specific two-word topics
      if (score > bestScore) {
        bestScore = score;
        bestKey = k;
      }
    }
    if (!bestKey) break;
    const members = items.filter((it) => !it.used && it.keys.has(bestKey));
    members.forEach((m) => (m.used = true));
    clusters.push({
      key: bestKey,
      queries: members.map((m) => m.q).sort((a, b) => b.demand - a.demand),
    });
  }
  return clusters;
}

// Step 3: score each cluster from the observed signals only.
function scoreClusters(clusters) {
  const maxDemand = Math.max(1e-9, ...clusters.map((c) => c.queries.reduce((s, q) => s + q.demand, 0)));
  return clusters.map((c, i) => {
    const demandRaw = c.queries.reduce((s, q) => s + q.demand, 0);
    const engines = new Set(c.queries.flatMap((q) => [...q.engines]));
    const questions = c.queries.filter((q) => QUESTION_START.test(q.text)).length;
    const avgWords = c.queries.reduce((s, q) => s + q.text.split(' ').length, 0) / c.queries.length;

    const demand = Math.round((demandRaw / maxDemand) * 100);
    const questionShare = Math.round((questions / c.queries.length) * 100);
    const reach = Math.round((engines.size / 3) * 100);
    const specificity = Math.round(Math.min(1, Math.max(0, (avgWords - 2) / 4)) * 100);
    const opportunity = Math.round(0.5 * demand + 0.2 * questionShare + 0.15 * reach + 0.15 * specificity);

    return {
      id: `c${i + 1}`,
      topic: c.key,
      queries: c.queries,
      metrics: {
        demand,
        questionShare,
        engines: [...engines].map((e) => ENGINES[e].label),
        queryCount: c.queries.length,
        specificity,
        opportunity,
      },
    };
  });
}

// Plain-language idea text built directly from the real queries (no AI).
function heuristicCopy(cluster, seedLabel) {
  const top = cluster.queries[0].text;
  const related = cluster.queries.slice(1, 5).map((q) => q.text);
  return {
    title: `${titleCase(top)}: A Practical Guide`,
    description: related.length
      ? `Answers what people are searching right now, including: ${related.join('; ')}.`
      : `A focused guide answering "${top}".`,
    audience: `People searching "${top}" and related ${seedLabel} questions.`,
    outline: cluster.queries.slice(0, 6).map((q) => titleCase(q.text)),
    difficulty: cluster.metrics.specificity > 60 ? 'easy' : cluster.metrics.specificity > 30 ? 'medium' : 'hard',
  };
}

export async function generateIdeas({ topic, niche, count = 10, lang = 'en', polish }) {
  const cleanTopic = (topic || '').trim().toLowerCase().slice(0, 80);
  const seeds = cleanTopic ? [cleanTopic] : NICHES[niche] || [];
  if (!seeds.length) throw Object.assign(new Error('Enter a topic, or pick a niche other than "Other".'), { status: 400 });
  const n = Math.max(3, Math.min(20, Number(count) || 10));

  const started = Date.now();
  const [{ queries, engineStats, requestCount }, trends] = await Promise.all([
    collectQueries(seeds, lang),
    Promise.all(seeds.map((s) => wikipediaTrend(s).catch(() => null))),
  ]);
  if (!queries.length) {
    throw Object.assign(new Error('No search suggestions came back. The data sources may be rate-limiting; try again shortly.'), { status: 502 });
  }

  const clusters = scoreClusters(clusterQueries(queries, seeds, n)).sort(
    (a, b) => b.metrics.opportunity - a.metrics.opportunity,
  );
  const seedLabel = cleanTopic || niche.toLowerCase();

  let copyById = Object.fromEntries(clusters.map((c) => [c.id, heuristicCopy(c, seedLabel)]));
  let ai = { used: false };
  if (polish) {
    try {
      const polished = await polish({ seedLabel, clusters });
      copyById = { ...copyById, ...polished.copyById };
      ai = { used: true, model: polished.model };
    } catch (err) {
      ai = { used: false, error: String(err.message || err) };
    }
  }

  const ideas = clusters.map((c) => ({
    id: c.id,
    topic: c.topic,
    ...copyById[c.id],
    metrics: c.metrics,
    exampleQueries: c.queries.slice(0, 8).map((q) => ({ text: q.text, engines: [...q.engines].map((e) => ENGINES[e].label) })),
  }));

  return {
    seeds,
    ideas,
    trend: trends.filter(Boolean),
    stats: {
      requests: requestCount,
      engineStats,
      uniqueQueries: queries.length,
      tookMs: Date.now() - started,
    },
    ai,
  };
}
