// Optional: reliable, richer Google Trends via Apify's maintained scraper
// (apify/google-trends-scraper). Set APIFY_TOKEN. Each run spends a little Apify
// credit and takes ~30s, so it's opt-in per search ("Deep Trends"), never the default.
const ACTOR = 'apify~google-trends-scraper';

export function apifyEnabled() {
  return Boolean(process.env.APIFY_TOKEN);
}

// Cache successful runs per topic-set for 6h: repeat searches are instant and
// don't spend more Apify credit.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

function trendFromTimeline(timeline) {
  const daily = (timeline || []).map((p) => Number(p.value?.[0] ?? 0)).filter((n) => Number.isFinite(n));
  if (daily.length < 20) return null;
  const half = Math.floor(daily.length / 2);
  const recent = daily.slice(-half);
  const prior = daily.slice(0, half);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  const changePct = priorAvg > 0 ? Math.round(((recentAvg - priorAvg) / priorAvg) * 100) : 0;
  return {
    source: 'Google Trends (Apify)',
    changePct,
    direction: changePct > 10 ? 'rising' : changePct < -10 ? 'falling' : 'stable',
    sparkline: daily,
  };
}

// Returns, per seed: related queries (top + rising) and a real interest trend.
export async function apifyTrends(seeds) {
  const key = [...seeds].sort().join('|');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const token = process.env.APIFY_TOKEN;
  const input = { searchTerms: seeds, isMultiple: seeds.length > 1, geo: 'US', timeRange: 'today 3-m' };
  // Capped wait: on the free plan a run can take ~30-60s, so if it overruns we
  // skip it for this search (other trend sources still fill in) rather than stall.
  const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(55000),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify Trends ${res.status}`);
  const items = await res.json();

  const queries = [];
  let topicTrend = null;
  for (const it of Array.isArray(items) ? items : []) {
    const pull = (arr, rising) =>
      (arr || []).forEach((q) => {
        const text = String(q.query || q.topic?.title || '').toLowerCase().trim();
        if (text) queries.push({ text, rising });
      });
    pull(it.relatedQueries_top, false);
    pull(it.relatedQueries_rising, true);
    if (!topicTrend) {
      const t = trendFromTimeline(it.interestOverTime_timelineData);
      if (t) topicTrend = { ...t, article: it.searchTerm, url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(it.searchTerm)}` };
    }
  }
  const value = { queries, topicTrend };
  cache.set(key, { at: Date.now(), value });
  return value;
}
