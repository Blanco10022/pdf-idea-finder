# PDF Idea Finder

Finds PDF guide ideas from **real search data**: the queries people are typing into Google, YouTube and DuckDuckGo right now, plus Wikipedia traffic as a topic trend signal. It's a rebuild of the PDF Trend Lab concept. Judging by its demo video, that tool shows AI-generated ideas with invented search volumes.

## How it works

1. **Collect.** For each seed (your topic, or 3 seeds for the chosen niche), ~45 autocomplete lookups expand it with question and problem modifiers (`how to …`, `why …`, `… mistakes`, `… for beginners`, `… a-z`). Typically 250–350 unique real queries.
2. **Group.** Queries are clustered around the most common shared sub-topics (e.g. "first night", "potty schedule", "not eating").
3. **Score.** Every number comes from the observed data:
   - **Demand**: how often and how high the cluster's queries rank across autocomplete lookups (relative to this search, 0–100).
   - **Questions**: share of queries phrased as questions (a sign of a problem to solve).
   - **Engines**: which engines surfaced it (Google, YouTube, DuckDuckGo).
   - **Opportunity**: 50% demand, 20% questions, 15% engine reach, 15% specificity (longer, niche queries).
   - **Topic trend**: Wikipedia daily pageviews, last 30 days vs the 60 before.
4. **Write (optional).** With `ANTHROPIC_API_KEY` set, Claude (`claude-opus-5-5`) writes each idea's title, description, audience and outline, using only that cluster's real queries. It never produces numbers. Without a key, titles come straight from the top real query.

Saved ideas and search history live in the browser's localStorage. Results and saved ideas export to CSV.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm start
```

Open http://localhost:3000. To enable Claude, copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, and start with `node --env-file=.env server.js`.

## API

- `GET /api/config`: niches and whether Claude is enabled
- `POST /api/ideas` with `{ "topic": "new puppy", "niche": "Pets", "count": 10, "useAi": true }`

The server caches each lookup for 6 hours and allows 12 searches per minute per IP.

## Limits (honest list)

- Autocomplete reflects popularity, but it is **not search volume**. Free sources don't give monthly volumes; a paid keyword API (DataForSEO, Keywords Everywhere) could add them later.
- No competition metric yet.
- Reddit blocks anonymous API access (403), so it isn't used.
- The Google/YouTube suggest endpoints are unofficial and can rate-limit heavy use.
