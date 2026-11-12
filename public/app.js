// Client-side app: hash router, generator form, result cards, saved ideas in localStorage.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable (private mode); app still works for this session */
    }
  },
};

let saved = store.get('saved', []);
let history = store.get('history', []);
let lastResult = null;

// ---------- Routing ----------
const TITLES = { dashboard: 'Dashboard', generate: 'Generate Ideas', saved: 'Saved Ideas' };
function route() {
  const name = location.hash.replace('#/', '') || 'dashboard';
  const view = TITLES[name] ? name : 'dashboard';
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== view));
  $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.route === view));
  $('#pageTitle').textContent = TITLES[view];
  $('#sidebar').classList.remove('open');
  if (view === 'dashboard') renderDashboard();
  if (view === 'saved') renderSaved();
}
window.addEventListener('hashchange', route);
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

// ---------- Theme ----------
function currentTheme() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('theme', t);
  } catch {
    /* ignore */
  }
  $('#themeBtn').textContent = t === 'dark' ? '☀' : '☾';
}
$('#themeBtn').addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
setTheme(currentTheme());

// ---------- Dashboard ----------
function renderDashboard() {
  $('#statSaved').textContent = saved.length;
  $('#statSearches').textContent = history.length;
  const last = history[0];
  $('#statLast').textContent = last ? last.label : '-';
  $('#lastSearchLabel').textContent = last ? `Resume "${last.label}"` : 'No searches yet';
}
$('#continueLast').addEventListener('click', () => {
  const last = history[0];
  if (!last) return;
  $('#topic').value = last.topic || '';
  $('#niche').value = last.niche;
  $('#count').value = last.count;
  $('#countLabel').textContent = last.count;
});

// ---------- Generator ----------
const PROVIDER_NAMES = { gemini: 'Gemini', groq: 'Groq', claude: 'Claude' };
async function loadConfig() {
  const cfg = await fetch('/api/config').then((r) => r.json());
  $('#niche').innerHTML = cfg.niches.map((n) => `<option>${n}</option>`).join('');
  aiAvailable = cfg.ai;
  $('#aiRow').hidden = !cfg.ai;
  $('#deepRow').hidden = !cfg.apify;
  if (cfg.ai) {
    const names = (cfg.providers || []).map((p) => PROVIDER_NAMES[p] || p);
    const label =
      names.length > 1
        ? `Compare ${names.join(' + ')} and pick the best (scores always come from real data)`
        : `Polish titles and outlines with ${names[0]} (scores always come from real data)`;
    $('#aiLabel').textContent = label;
  }
  // Show which real data sources are live.
  const src = cfg.sources || {};
  const live = [
    ...(src.autocomplete || []),
    src.youtube && 'YouTube data',
    src.reddit && 'Reddit',
    src.stackexchange && 'Stack Exchange',
    src.trends && 'Google Trends',
    src.datamuse && 'Datamuse',
    src.openlibrary && 'Open Library (competition)',
    src.wikipedia && 'Wikipedia',
  ].filter(Boolean);
  const el = $('#sourcesLine');
  if (el) el.textContent = `Live data sources: ${live.join(', ')}`;
}
$('#count').addEventListener('input', (e) => ($('#countLabel').textContent = e.target.value));

$('#genForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    topic: $('#topic').value.trim(),
    niche: $('#niche').value,
    count: Number($('#count').value),
    useAi: !$('#aiRow').hidden && $('#useAi').checked,
    deepTrends: !$('#deepRow').hidden && $('#deepTrends').checked,
  };
  $('#genError').hidden = true;
  $('#genBtn').disabled = true;
  $('#loading').hidden = false;
  $('#results').innerHTML = '';
  try {
    const res = await fetch('/api/ideas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    lastResult = data;
    const label = body.topic || body.niche;
    history = [{ label, topic: body.topic, niche: body.niche, count: body.count, at: Date.now() }, ...history].slice(0, 20);
    store.set('history', history);
    renderResults(data);
  } catch (err) {
    $('#genError').textContent = err.message;
    $('#genError').hidden = false;
  } finally {
    $('#genBtn').disabled = false;
    $('#loading').hidden = true;
  }
});

function sparkline(values, w = 140, h = 34) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / (max - min || 1)) * (h - 4) - 2).toFixed(1)}`)
    .join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.6" points="${pts}"/></svg>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function compact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
// Show the strongest real engagement proof the cluster has.
function engagementLabel(m) {
  if (m.ytViews > 0) return `${compact(m.ytViews)} YT views`;
  if (m.redditScore > 0) return `${compact(m.redditScore)} upvotes`;
  return '—';
}
// Lower competition (fewer existing books) is better.
function competitionLabel(m) {
  if (m.competition == null) return { text: 'n/a', cls: '' };
  if (m.competition < 33) return { text: 'low', cls: 'good' };
  if (m.competition < 66) return { text: 'medium', cls: 'warn' };
  return { text: 'high', cls: 'bad' };
}

function renderResults(data) {
  const root = $('#results');
  const trendHtml = data.trend
    .map((t) => {
      const cls = t.direction === 'rising' ? 'good' : t.direction === 'falling' ? 'bad' : 'warn';
      const sign = t.changePct > 0 ? '+' : '';
      return `<div class="panel trend-box" style="color:var(--accent)">${sparkline(t.sparkline)}
        <div style="color:var(--text)"><b>Topic interest: <span class="chip ${cls}">${t.direction} ${sign}${t.changePct}%</span></b><br>
        <span class="muted">Wikipedia "<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.article)}</a>": ${t.dailyViewsRecent.toLocaleString()} views/day last 30 days vs ${t.dailyViewsPrior.toLocaleString()} before</span></div></div>`;
    })
    .join('');

  const s = data.stats;
  const used = Object.entries(s.sourceStats)
    .filter(([, v]) => v.requests > v.failed)
    .map(([k]) => k);
  const aiNote = data.ai.used
    ? ` Copy by ${esc(data.ai.model)}${data.ai.judged ? ' (compared & merged)' : ''}.`
    : data.ai.error
      ? ` AI polish failed (${esc(data.ai.error)}); showing data-only titles.`
      : '';

  root.innerHTML = `
    <div class="summary">
      <h3>Generated ideas (${data.ideas.length})</h3>
      <button class="btn-ghost" id="exportResults">Export CSV</button>
    </div>
    <p class="note">Built from ${s.uniqueQueries} real signals across ${used.length} sources (${esc(used.join(', '))}) in ${(s.tookMs / 1000).toFixed(1)}s.
      Demand, engagement and opportunity are relative to this search, not absolute search volumes.${aiNote}</p>
    ${trendHtml}
    <div class="cards" id="cards"></div>`;
  const cards = $('#cards');
  data.ideas.forEach((idea) => cards.appendChild(buildCard(idea, data.trend[0])));
  $('#exportResults').addEventListener('click', () => downloadCsv(data.ideas, 'pdf-ideas.csv'));
}

function buildCard(idea, trend) {
  const el = $('#cardTpl').content.firstElementChild.cloneNode(true);
  $('.card-title', el).textContent = idea.title;
  $('.card-desc', el).textContent = idea.description;
  $('.card-aud', el).textContent = '👥 ' + idea.audience;
  const m = idea.metrics;
  const diffCls = { easy: 'good', medium: 'warn', hard: 'bad' }[idea.difficulty] || '';
  const chips = [`<span class="chip ${diffCls}">${esc(idea.difficulty)} to write</span>`, `<span class="chip">${esc(idea.topic)}</span>`];
  if (m.rising) chips.push('<span class="chip good">↗ rising on Trends</span>');
  if (trend) chips.push(`<span class="chip">${trend.direction === 'rising' ? '↗' : trend.direction === 'falling' ? '↘' : '→'} topic ${esc(trend.direction)}</span>`);
  $('.chips', el).innerHTML = chips.join('');
  $('.m-demand', el).textContent = `${m.demand}/100`;
  $('.m-demand-bar', el).style.width = `${m.demand}%`;
  $('.m-questions', el).textContent = `${m.questionShare}%`;
  $('.m-queries', el).textContent = m.queryCount;
  $('.m-engagement', el).textContent = engagementLabel(m);
  const comp = competitionLabel(m);
  $('.m-competition', el).textContent = comp.text;
  $('.m-competition', el).className = `m-competition ${comp.cls}`;
  $('.m-books', el).textContent = m.bookCount == null ? '—' : m.bookCount.toLocaleString();
  $('.m-sources', el).innerHTML = (m.sources || []).map((s) => `<span class="chip">${esc(s)}</span>`).join(' ');
  $('.m-score', el).innerHTML = `${m.opportunity}<small>/100</small>`;
  $('.q-summary', el).textContent = `Show real search queries (${idea.exampleQueries.length})`;
  $('.queries', el).innerHTML = idea.exampleQueries
    .map((q) => `<li>${esc(q.text)} <span class="eng">${esc((q.sources || []).join(' · '))}</span></li>`)
    .join('');
  $('.outline', el).innerHTML = (idea.outline || []).map((o) => `<li>${esc(o)}</li>`).join('');

  wirePdfButton($('.pdf-btn', el), $('.pdf-status', el), idea);

  const btn = $('.save-btn', el);
  const key = idea.title.toLowerCase();
  const sync = () => {
    const isSaved = saved.some((s) => s.title.toLowerCase() === key);
    btn.classList.toggle('saved', isSaved);
    btn.textContent = isSaved ? '★ Saved' : '☆ Save';
  };
  btn.addEventListener('click', () => {
    if (saved.some((s) => s.title.toLowerCase() === key)) saved = saved.filter((s) => s.title.toLowerCase() !== key);
    else saved = [{ ...idea, savedAt: Date.now() }, ...saved];
    store.set('saved', saved);
    updateBadge();
    sync();
    if (location.hash === '#/saved') renderSaved();
  });
  sync();
  return el;
}

// ---------- Saved ----------
function renderSaved() {
  $('#savedCount').textContent = `${saved.length} saved idea${saved.length === 1 ? '' : 's'}`;
  const list = $('#savedList');
  list.innerHTML = '';
  if (!saved.length) {
    list.innerHTML = '<div class="empty">No saved ideas yet. Generate some and click Save.</div>';
    return;
  }
  saved.forEach((idea) => list.appendChild(buildCard(idea)));
}
$('#exportSaved').addEventListener('click', () => downloadCsv(saved, 'saved-pdf-ideas.csv'));

function downloadCsv(ideas, filename) {
  const cols = ['title', 'description', 'audience', 'difficulty', 'opportunity', 'demand', 'competition', 'existingBooks', 'engagement', 'questionShare', 'queryCount', 'sources', 'exampleQueries', 'outline'];
  const cell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const rows = ideas.map((i) =>
    [
      i.title, i.description, i.audience, i.difficulty, i.metrics.opportunity, i.metrics.demand, competitionLabel(i.metrics).text, i.metrics.bookCount ?? '',
      engagementLabel(i.metrics), i.metrics.questionShare, i.metrics.queryCount, (i.metrics.sources || []).join(' | '), i.exampleQueries.map((q) => q.text).join(' | '), (i.outline || []).join(' | '),
    ].map(cell).join(','),
  );
  const blob = new Blob([[cols.join(','), ...rows].join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  a.click();
  URL.revokeObjectURL(a.href);
}

let aiAvailable = false;
function wirePdfButton(btn, status, idea) {
  if (!aiAvailable) {
    btn.disabled = true;
    btn.title = 'Add a Gemini, Groq or Claude key to generate guides';
  }
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '⏳ Writing your guide…';
    status.hidden = true;
    try {
      const res = await fetch('/api/guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed (${res.status})`);
      const blob = await res.blob();
      const name = (res.headers.get('Content-Disposition')?.match(/filename="(.+?)"/) || [])[1] || 'guide.pdf';
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      a.click();
      URL.revokeObjectURL(a.href);
      status.hidden = false;
      status.className = 'pdf-status ok';
      status.textContent = `✓ Downloaded "${name}"`;
    } catch (err) {
      status.hidden = false;
      status.className = 'pdf-status err';
      status.textContent = err.message;
    } finally {
      btn.disabled = !aiAvailable;
      btn.textContent = label;
    }
  });
}

function updateBadge() {
  $('#savedBadge').textContent = saved.length;
}

updateBadge();
loadConfig().catch(() => {
  $('#genError').textContent = 'Could not reach the server.';
  $('#genError').hidden = false;
});
route();
