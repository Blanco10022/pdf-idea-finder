import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateIdeas, NICHES } from './lib/ideas.js';
import { aiEnabled, activeProviders, polish } from './lib/ai.js';
import { sourceStatus } from './lib/sources.js';
import { apifyEnabled } from './lib/apify-trends.js';
import { writeGuide } from './lib/guide.js';
import { renderGuidePdf } from './lib/pdf.js';

const safeName = (s) => (s || 'guide').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'guide';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Simple per-IP rate limit so a public deployment can't be used to hammer the data sources.
const hits = new Map();
function rateLimited(ip, limit = 12, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > limit;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, maxBytes = 10_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function serveStatic(req, res) {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = normalize(path === '/' ? 'index.html' : path.slice(1));
  if (rel.startsWith('..')) return sendJson(res, 400, { error: 'Bad path' });
  try {
    const data = await readFile(join(PUBLIC_DIR, rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // Single-page app: unknown paths fall back to the shell.
    const data = await readFile(join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': TYPES['.html'] });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/config') {
      return sendJson(res, 200, {
        niches: Object.keys(NICHES),
        ai: aiEnabled(),
        providers: activeProviders(),
        sources: sourceStatus(),
        apify: apifyEnabled(),
      });
    }
    if (req.method === 'POST' && req.url === '/api/ideas') {
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
      if (rateLimited(ip)) return sendJson(res, 429, { error: 'Too many searches. Wait a minute and try again.' });
      const body = await readBody(req);
      const result = await generateIdeas({
        topic: body.topic,
        niche: body.niche,
        count: body.count,
        polish: body.useAi && aiEnabled() ? polish : null,
        deepTrends: Boolean(body.deepTrends) && apifyEnabled(),
      });
      return sendJson(res, 200, result);
    }
    if (req.method === 'POST' && req.url === '/api/guide') {
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
      if (rateLimited(ip, 6)) return sendJson(res, 429, { error: 'Too many guide generations. Wait a minute and try again.' });
      const body = await readBody(req, 60_000);
      if (!body.idea?.title) return sendJson(res, 400, { error: 'Missing idea.' });
      const { guide, model } = await writeGuide(body.idea);
      const pdf = await renderGuidePdf(guide);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName(guide.title)}.pdf"`,
        'X-Guide-Model': model,
        'Cache-Control': 'no-store',
      });
      return res.end(pdf);
    }
    if (req.method === 'GET') return serveStatic(req, res);
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    const status = err.status || (err instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error(err);
    sendJson(res, status, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`PDF Idea Finder running at http://localhost:${PORT} (Claude polish: ${aiEnabled() ? 'on' : 'off'})`);
});
