// Real search-data sources. All are free, keyless, public endpoints.
// Every fetch goes through a small in-memory cache and a concurrency limiter
// so one idea search stays polite (and fast on repeat searches).

const UA = 'pdf-idea-finder/0.1 (+https://github.com/; research tool)';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

async function cachedJson(url, { parse = (t) => JSON.parse(t), timeoutMs = 8000 } = {}) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${new URL(url).host}`);
  const value = parse(await res.text());
  cache.set(url, { at: Date.now(), value });
  return value;
}

// Run async tasks with at most `limit` in flight.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (err) {
        out[i] = { ok: false, error: String(err.message || err) };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// --- Autocomplete engines -------------------------------------------------
// Each returns an ordered list of suggestions (most popular first).

export const ENGINES = {
  google: {
    label: 'Google',
    url: (q, lang) =>
      `https://suggestqueries.google.com/complete/search?client=firefox&hl=${lang}&gl=us&q=${encodeURIComponent(q)}`,
  },
  youtube: {
    label: 'YouTube',
    url: (q, lang) =>
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=${lang}&q=${encodeURIComponent(q)}`,
  },
  duckduckgo: {
    label: 'DuckDuckGo',
    url: (q) => `https://duckduckgo.com/ac/?type=list&q=${encodeURIComponent(q)}`,
  },
};

export async function suggest(engine, query, lang = 'en') {
  const data = await cachedJson(ENGINES[engine].url(query, lang));
  const list = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  return list.map((s) => String(s).toLowerCase().trim()).filter(Boolean);
}

// --- Wikipedia pageviews: real daily traffic, used as a topic trend signal ---

function ymd(d) {
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ies)$/, 'y').replace(/s$/, '');

const WIKI_STOP = new Set(['for', 'the', 'a', 'an', 'of', 'to', 'and', 'with', 'in', 'on', 'your', 'my', 'how', 'best', 'top']);

// Candidate articles whose titles contain every meaningful word we searched for.
// We try the full phrase, then progressively shorter trailing windows
// ("meal prep for weight loss" -> "weight loss" -> "loss"), because the tail is
// usually the head noun. Stopwords are ignored so "for weight loss" still
// matches the "Weight loss" article. Single generic words ("loss") are a last
// resort and only used if nothing better matched.
async function candidateArticles(topic) {
  const parts = topic.trim().split(/\s+/);
  const tries = [topic];
  for (let n = Math.min(3, parts.length - 1); n >= 1; n--) tries.push(parts.slice(-n).join(' '));

  const out = [];
  for (const q of [...new Set(tries)]) {
    const want = q.split(/\s+/).map(norm).filter((w) => w && !WIKI_STOP.has(w));
    if (!want.length) continue;
    const search = await cachedJson(
      `https://en.wikipedia.org/w/api.php?action=opensearch&limit=5&namespace=0&format=json&search=${encodeURIComponent(q)}`,
    );
    for (const title of search?.[1] || []) {
      const have = new Set(title.split(/\s+/).map(norm));
      if (want.every((w) => have.has(w)) && !out.includes(title)) out.push(title);
    }
    if (out.length) return out.slice(0, 3); // stop at the most specific window that matched
  }
  return out.slice(0, 3);
}

// Below this many daily views the trend is mostly noise, so we skip the article.
const MIN_DAILY_VIEWS = 50;

export async function wikipediaTrend(topic) {
  for (const title of await candidateArticles(topic)) {
    const trend = await articleTrend(title);
    if (trend && trend.dailyViewsRecent >= MIN_DAILY_VIEWS) return trend;
  }
  return null;
}

async function articleTrend(title) {
  const end = new Date(Date.now() - 24 * 3600 * 1000);
  const start = new Date(end.getTime() - 89 * 24 * 3600 * 1000);
  const article = encodeURIComponent(title.replaceAll(' ', '_'));
  const views = await cachedJson(
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${article}/daily/${ymd(start)}/${ymd(end)}`,
  );
  const daily = (views?.items || []).map((i) => i.views);
  if (daily.length < 45) return null;

  const recent = daily.slice(-30);
  const prior = daily.slice(0, -30);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  const changePct = priorAvg > 0 ? ((recentAvg - priorAvg) / priorAvg) * 100 : 0;
  return {
    article: title,
    url: `https://en.wikipedia.org/wiki/${article}`,
    dailyViewsRecent: Math.round(recentAvg),
    dailyViewsPrior: Math.round(priorAvg),
    changePct: Math.round(changePct),
    direction: changePct > 10 ? 'rising' : changePct < -10 ? 'falling' : 'stable',
    sparkline: daily,
  };
}
