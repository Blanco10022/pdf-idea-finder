// Real search-data sources. Everything here is free and legit. Each external
// source is OPTIONAL and self-activates when its credential env var is present;
// without it, the source is skipped (never fatal). All fetches go through a
// shared cache + timeout so one idea search stays polite.

const UA = 'pdf-idea-finder/0.2 (research tool)';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

async function cachedJson(url, { parse = JSON.parse, timeoutMs = 9000, headers } = {}) {
  const key = url;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${new URL(url).host}`);
  const value = parse(await res.text());
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Run async tasks with at most `limit` in flight; never throws (per-item result).
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
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
// Firefox-format endpoints return [query, [suggestions...]]; the shops return
// their own JSON shapes. `weight` is a rough popularity/intent prior.

export const ENGINES = {
  google: {
    label: 'Google',
    weight: 1,
    url: (q, lang) => `https://suggestqueries.google.com/complete/search?client=firefox&hl=${lang}&gl=us&q=${encodeURIComponent(q)}`,
    parse: (t) => JSON.parse(t)[1] || [],
  },
  youtube: {
    label: 'YouTube',
    weight: 0.8,
    url: (q, lang) => `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=${lang}&q=${encodeURIComponent(q)}`,
    parse: (t) => JSON.parse(t)[1] || [],
  },
  duckduckgo: {
    label: 'DuckDuckGo',
    weight: 0.6,
    url: (q) => `https://duckduckgo.com/ac/?type=list&q=${encodeURIComponent(q)}`,
    parse: (t) => JSON.parse(t)[1] || [],
  },
  amazon: {
    label: 'Amazon',
    weight: 0.9, // buyer intent: what people shop for
    url: (q) => `https://completion.amazon.com/api/2017/suggestions?mid=ATVPDKIKX0DER&alias=aps&prefix=${encodeURIComponent(q)}`,
    parse: (t) => (JSON.parse(t).suggestions || []).map((s) => s.value),
  },
  ebay: {
    label: 'eBay',
    weight: 0.7,
    url: (q) => `https://autosug.ebay.com/autosug?kwd=${encodeURIComponent(q)}&_jgr=1&sId=0&callback=0`,
    parse: (t) => JSON.parse(t)?.res?.sug || [],
  },
};

export async function suggest(engine, query, lang = 'en') {
  const e = ENGINES[engine];
  const list = await cachedJson(e.url(query, lang), { parse: e.parse });
  return (Array.isArray(list) ? list : []).map((s) => String(s).toLowerCase().trim()).filter(Boolean);
}

// --- YouTube Data API: real video titles + view counts (demand signal) -----
// Enable "YouTube Data API v3" in Google Cloud, create an API key, set YOUTUBE_API_KEY.
export function youtubeEnabled() {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

export async function youtubeSignals(seed) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const search = await cachedJson(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&order=relevance&q=${encodeURIComponent(seed)}&key=${key}`,
  );
  const ids = (search.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const stats = await cachedJson(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(',')}&key=${key}`,
  );
  return (stats.items || []).map((v) => ({
    text: v.snippet.title.toLowerCase().trim(),
    views: Number(v.statistics?.viewCount || 0),
  }));
}

// --- Reddit: real questions/pain points from a free "script" app ----------
// Create one at https://www.reddit.com/prefs/apps (type: script); set
// REDDIT_CLIENT_ID and REDDIT_SECRET.
let redditToken = { value: null, exp: 0 };
export function redditEnabled() {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_SECRET);
}

async function redditAccessToken() {
  if (redditToken.value && Date.now() < redditToken.exp) return redditToken.value;
  const basic = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_SECRET}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`Reddit auth ${res.status}`);
  const data = await res.json();
  redditToken = { value: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  return redditToken.value;
}

export async function redditSignals(seed) {
  if (!redditEnabled()) return [];
  const token = await redditAccessToken();
  const res = await fetch(
    `https://oauth.reddit.com/search?q=${encodeURIComponent(seed)}&sort=top&t=year&limit=25&type=link`,
    { headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA }, signal: AbortSignal.timeout(9000) },
  );
  if (!res.ok) throw new Error(`Reddit search ${res.status}`);
  const data = await res.json();
  return (data.data?.children || []).map((c) => ({
    text: c.data.title.toLowerCase().trim(),
    score: Number(c.data.score || 0),
    comments: Number(c.data.num_comments || 0),
    subreddit: c.data.subreddit,
  }));
}

// --- Google Trends related/rising queries (best-effort, no key) ------------
// Two-step token flow; frequently rate-limits, so always wrapped non-fatally.
const stripXss = (t) => JSON.parse(t.replace(/^\)\]\}',?\s*/, ''));

export async function googleTrendsQueries(seed) {
  try {
    const exploreReq = {
      comparisonItem: [{ keyword: seed, geo: 'US', time: 'today 12-m' }],
      category: 0,
      property: '',
    };
    const explore = await cachedJson(
      `https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=${encodeURIComponent(JSON.stringify(exploreReq))}`,
      { parse: stripXss },
    );
    const widget = (explore.widgets || []).find((w) => w.id === 'RELATED_QUERIES');
    if (!widget) return [];
    const data = await cachedJson(
      `https://trends.google.com/trends/api/widgetdata/relatedsearches?hl=en-US&tz=0&req=${encodeURIComponent(
        JSON.stringify(widget.request),
      )}&token=${widget.token}`,
      { parse: stripXss },
    );
    const lists = data.default?.rankedList || [];
    const out = [];
    lists.forEach((list, idx) => {
      for (const kw of list.rankedKeyword || []) {
        out.push({ text: String(kw.query).toLowerCase().trim(), rising: idx === 1 });
      }
    });
    return out;
  } catch {
    return []; // Trends is the flakiest source; never let it break a search.
  }
}

// --- Wikipedia pageviews: topic-level trend signal -------------------------
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ies)$/, 'y').replace(/s$/, '');
const WIKI_STOP = new Set(['for', 'the', 'a', 'an', 'of', 'to', 'and', 'with', 'in', 'on', 'your', 'my', 'how', 'best', 'top']);

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
    if (out.length) return out.slice(0, 3);
  }
  return out.slice(0, 3);
}

const MIN_DAILY_VIEWS = 50;
function ymd(d) {
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

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

// Which sources are currently active (for /api/config and the results note).
export function sourceStatus() {
  return {
    autocomplete: Object.keys(ENGINES).map((e) => ENGINES[e].label),
    youtube: youtubeEnabled(),
    reddit: redditEnabled(),
    trends: true,
    wikipedia: true,
  };
}
