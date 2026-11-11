import {
  suggest,
  pool,
  wikipediaTrend,
  youtubeSignals,
  redditSignals,
  googleTrendsQueries,
  youtubeEnabled,
  redditEnabled,
  ENGINES,
} from './sources.js';
import { apifyEnabled, apifyTrends } from './apify-trends.js';

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

// Question/problem modifiers for web-search autocomplete.
const WEB_TEMPLATES = [
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
  (s) => `${s}`,
];
const WEB_AZ = 'abcdefghilmnprstw'.split('').map((l) => (s) => `${s} ${l}`);
const SHORT_TEMPLATES = [(s) => `how to ${s}`, (s) => `${s}`, (s) => `${s} tips`, (s) => `${s} for beginners`, (s) => `why ${s}`, (s) => `${s} mistakes`];
// Shops reward product/buyer-intent phrasing.
const SHOP_TEMPLATES = [(s) => `${s}`, (s) => `${s} guide`, (s) => `${s} book`, (s) => `${s} for beginners`, (s) => `${s} planner`];

const ENGINE_TEMPLATES = {
  google: (full) => (full ? [...WEB_TEMPLATES, ...WEB_AZ] : WEB_TEMPLATES),
  youtube: () => SHORT_TEMPLATES,
  duckduckgo: () => SHORT_TEMPLATES,
  amazon: () => SHOP_TEMPLATES,
  ebay: () => SHOP_TEMPLATES,
};

const STOPWORDS = new Set(
  ('a an the and or but if of to in on at by for from with without into over under about as is are was were be been ' +
    'do does did doing done i me my mine you your yours we our it its this that these those there here what which who whom ' +
    'why when where how can could should would will shall may might must not no yes vs versus best good better way ways ' +
    'get got make made use using need needs want really very so too much many more most near me online free 2024 2025 2026 2027 ' +
    'tips help guide beginners beginner reddit youtube video videos pdf book books meaning definition review reviews')
    .split(' '),
);
const QUESTION_START = /^(how|why|what|when|where|which|who|can|could|should|is|are|do|does|did|will|would)\b/;

function words(q) {
  return q.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
}
function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
function titleCase(s) {
  const small = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'vs', 'at', 'by']);
  return s.split(' ').map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Merge one observed phrase into the query map with its source signal.
function addSignal(map, text, seed, { source, demand, views = 0, redditScore = 0, rising = false }) {
  const n = text.toLowerCase().trim();
  const wc = n.split(/\s+/).length;
  if (wc < 2 || wc > 16 || n.length < 6) return;
  const rec = map.get(n) || { text: n, seed, demand: 0, sources: new Set(), views: 0, redditScore: 0, rising: false };
  rec.demand += demand;
  rec.sources.add(source);
  rec.views = Math.max(rec.views, views);
  rec.redditScore = Math.max(rec.redditScore, redditScore);
  rec.rising = rec.rising || rising;
  map.set(n, rec);
}

// Step 1: collect real signals from every enabled source.
async function collectQueries(seeds, lang, opts = {}) {
  const full = seeds.length === 1; // deep a-z expansion only for single-topic searches
  const autoJobs = [];
  for (const seed of seeds)
    for (const engine of Object.keys(ENGINES))
      for (const t of ENGINE_TEMPLATES[engine](full)) autoJobs.push({ engine, prompt: t(seed), seed });

  const sourceStats = {};
  const bump = (name, failed = false) => {
    sourceStats[name] ??= { requests: 0, failed: 0 };
    sourceStats[name].requests++;
    if (failed) sourceStats[name].failed++;
  };

  const map = new Map();

  // Kick off Apify deep Trends early (it's the slowest) so it overlaps the rest.
  const apifyPromise =
    opts.deepTrends && apifyEnabled()
      ? apifyTrends(seeds).then((r) => ({ ok: true, r })).catch((e) => ({ ok: false, e }))
      : null;

  // Autocomplete (concurrent).
  const autoResults = await pool(autoJobs, 8, (j) => suggest(j.engine, j.prompt, lang));
  autoResults.forEach((r, i) => {
    const job = autoJobs[i];
    bump(ENGINES[job.engine].label, !r.ok);
    if (!r.ok) return;
    r.value.forEach((text, rank) =>
      addSignal(map, text, job.seed, { source: ENGINES[job.engine].label, demand: ENGINES[job.engine].weight * (1 - rank / 12) }),
    );
  });

  // Extra per-seed sources (YouTube, Reddit, Trends), concurrent, non-fatal.
  const extra = [];
  for (const seed of seeds) {
    if (youtubeEnabled()) extra.push({ kind: 'youtube', seed });
    if (redditEnabled()) extra.push({ kind: 'reddit', seed });
    extra.push({ kind: 'trends', seed });
  }
  const extraResults = await pool(extra, 4, async (e) => {
    if (e.kind === 'youtube') return { kind: 'youtube', data: await youtubeSignals(e.seed), seed: e.seed };
    if (e.kind === 'reddit') return { kind: 'reddit', data: await redditSignals(e.seed), seed: e.seed };
    return { kind: 'trends', data: await googleTrendsQueries(e.seed), seed: e.seed };
  });
  extraResults.forEach((r, i) => {
    const label = { youtube: 'YouTube data', reddit: 'Reddit', trends: 'Google Trends' }[extra[i].kind];
    bump(label, !r.ok);
    if (!r.ok) return;
    const { kind, data, seed } = r.value;
    if (kind === 'youtube')
      data.forEach((v) => addSignal(map, v.text, seed, { source: 'YouTube data', demand: 0.8 * clamp01(Math.log10(v.views + 1) / 7), views: v.views }));
    else if (kind === 'reddit')
      data.forEach((p) => addSignal(map, p.text, seed, { source: 'Reddit', demand: 0.6 * clamp01(Math.log10(p.score + 1) / 4), redditScore: p.score }));
    else data.forEach((q) => addSignal(map, q.text, seed, { source: 'Google Trends', demand: q.rising ? 0.9 : 0.7, rising: q.rising }));
  });

  // Apify deep Trends (opt-in): richer related queries + a real interest trend line.
  let apifyTrend = null;
  if (apifyPromise) {
    const a = await apifyPromise;
    bump('Google Trends (Apify)', !a.ok);
    if (a.ok) {
      a.r.queries.forEach((q) => addSignal(map, q.text, seeds[0], { source: 'Google Trends (Apify)', demand: q.rising ? 0.95 : 0.75, rising: q.rising }));
      apifyTrend = a.r.topicTrend;
    }
  }

  return { queries: [...map.values()], sourceStats, requestCount: autoJobs.length + extra.length, apifyTrend };
}

// Step 2: group queries into idea clusters around shared sub-topics.
function clusterQueries(queries, seeds, maxClusters) {
  const seedTokens = seeds.flatMap((s) => words(s).map(stem));
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
      const score = w * (k.includes(' ') ? 1.35 : 1);
      if (score > bestScore) {
        bestScore = score;
        bestKey = k;
      }
    }
    if (!bestKey) break;
    const members = items.filter((it) => !it.used && it.keys.has(bestKey));
    members.forEach((m) => (m.used = true));
    clusters.push({ key: bestKey, queries: members.map((m) => m.q).sort((a, b) => b.demand - a.demand) });
  }
  return clusters;
}

// Step 3: score each cluster from observed signals only.
function scoreClusters(clusters) {
  const sumDemand = (c) => c.queries.reduce((s, q) => s + q.demand, 0);
  const maxDemand = Math.max(1e-9, ...clusters.map(sumDemand));
  const totalSources = 7; // 5 autocomplete + YouTube data + Reddit + Trends overlap into labels

  return clusters.map((c, i) => {
    const sources = new Set(c.queries.flatMap((q) => [...q.sources]));
    const questions = c.queries.filter((q) => QUESTION_START.test(q.text)).length;
    const avgWords = c.queries.reduce((s, q) => s + q.text.split(' ').length, 0) / c.queries.length;
    const ytViews = Math.max(0, ...c.queries.map((q) => q.views));
    const redditScore = Math.max(0, ...c.queries.map((q) => q.redditScore));
    const rising = c.queries.some((q) => q.rising);

    const demand = Math.round((sumDemand(c) / maxDemand) * 100);
    const questionShare = Math.round((questions / c.queries.length) * 100);
    const reach = Math.round(clamp01(sources.size / totalSources) * 100);
    const specificity = Math.round(clamp01((avgWords - 2) / 4) * 100);
    const engagement = Math.round(Math.max(clamp01(Math.log10(ytViews + 1) / 7), clamp01(Math.log10(redditScore + 1) / 4)) * 100);

    const opportunity = Math.round(
      0.4 * demand + 0.15 * questionShare + 0.13 * reach + 0.12 * specificity + 0.2 * engagement + (rising ? 5 : 0),
    );

    return {
      id: `c${i + 1}`,
      topic: c.key,
      queries: c.queries,
      metrics: {
        demand,
        questionShare,
        sources: [...sources],
        queryCount: c.queries.length,
        specificity,
        engagement,
        ytViews,
        redditScore,
        rising,
        opportunity: Math.min(100, opportunity),
      },
    };
  });
}

function heuristicCopy(cluster, seedLabel) {
  const top = cluster.queries[0].text;
  const related = cluster.queries.slice(1, 5).map((q) => q.text);
  return {
    title: `${titleCase(top)}: A Practical Guide`,
    description: related.length ? `Answers what people are searching right now, including: ${related.join('; ')}.` : `A focused guide answering "${top}".`,
    audience: `People searching "${top}" and related ${seedLabel} questions.`,
    outline: cluster.queries.slice(0, 6).map((q) => titleCase(q.text)),
    difficulty: cluster.metrics.specificity > 60 ? 'easy' : cluster.metrics.specificity > 30 ? 'medium' : 'hard',
  };
}

export async function generateIdeas({ topic, niche, count = 10, lang = 'en', polish, deepTrends = false }) {
  const cleanTopic = (topic || '').trim().toLowerCase().slice(0, 80);
  const seeds = cleanTopic ? [cleanTopic] : NICHES[niche] || [];
  if (!seeds.length) throw Object.assign(new Error('Enter a topic, or pick a niche other than "Other".'), { status: 400 });
  const n = Math.max(3, Math.min(20, Number(count) || 10));

  const started = Date.now();
  const [{ queries, sourceStats, requestCount, apifyTrend }, wikiTrends] = await Promise.all([
    collectQueries(seeds, lang, { deepTrends }),
    Promise.all(seeds.map((s) => wikipediaTrend(s).catch(() => null))),
  ]);
  // Prefer the real Apify Google Trends line when present; keep Wikipedia as backup.
  const trends = [apifyTrend, ...wikiTrends];
  if (!queries.length) {
    throw Object.assign(new Error('No search data came back. Sources may be rate-limiting; try again shortly.'), { status: 502 });
  }

  const clusters = scoreClusters(clusterQueries(queries, seeds, n)).sort((a, b) => b.metrics.opportunity - a.metrics.opportunity);
  const seedLabel = cleanTopic || niche.toLowerCase();

  let copyById = Object.fromEntries(clusters.map((c) => [c.id, heuristicCopy(c, seedLabel)]));
  let ai = { used: false };
  if (polish) {
    try {
      const polished = await polish({ seedLabel, clusters });
      copyById = { ...copyById, ...polished.copyById };
      ai = { used: true, model: polished.model, judged: polished.judged };
    } catch (err) {
      ai = { used: false, error: String(err.message || err) };
    }
  }

  const ideas = clusters.map((c) => ({
    id: c.id,
    topic: c.topic,
    ...copyById[c.id],
    metrics: c.metrics,
    exampleQueries: c.queries.slice(0, 8).map((q) => ({ text: q.text, sources: [...q.sources] })),
  }));

  return {
    seeds,
    ideas,
    trend: trends.filter(Boolean).slice(0, 3),
    stats: { requests: requestCount, sourceStats, uniqueQueries: queries.length, tookMs: Date.now() - started },
    ai,
  };
}
