# PDF Idea Finder

Finds PDF guide ideas from **real search data**: the queries people are typing into Google, YouTube and DuckDuckGo right now, plus Wikipedia traffic as a topic trend signal. It's a rebuild of the PDF Trend Lab concept. Judging by its demo video, that tool shows AI-generated ideas with invented search volumes.

## How it works

1. **Collect.** For each seed (your topic, or 3 seeds for the chosen niche), it gathers real signals from every configured source:
   - **Autocomplete** (always on): Google, YouTube, DuckDuckGo, Amazon, eBay — expanded with question/problem/buyer modifiers (`how to …`, `… mistakes`, `… for beginners`, `… a-z`). ~250–350 unique queries.
   - **Stack Exchange** (keyless): real questions from the Q&A site matching the niche (Cooking, Money, Parenting, Pets, …).
   - **Datamuse** (keyless): a few close related phrases per seed, lightly probed for adjacent angles.
   - **Open Library** (keyless): existing-book count per idea → a **competition / saturation** metric. Few books = underserved; many = crowded.
   - **YouTube Data API** (if `YOUTUBE_API_KEY`): real video titles + **view counts** (engagement signal).
   - **Reddit** (if `REDDIT_CLIENT_ID`/`REDDIT_SECRET`): top post titles + upvotes (real pain points).
   - **Google Trends** (free endpoint, best-effort) and **Wikipedia pageviews** for topic trend.
   - **Deep Google Trends via Apify** (opt-in toggle, if `APIFY_TOKEN`): reliable related/rising queries + a real interest-over-time line. Slower (~30–60s) and spends Apify credit, so it's off by default and cached per topic.
2. **Group.** Signals are clustered around shared sub-topics (e.g. "first night", "potty schedule").
   A relevance gate drops any cluster that never mentions a seed word, so expansion/autocomplete drift can't produce off-topic ideas.
3. **Score** (all from observed data, relative to this search): **Demand**, **Competition** (from existing-book counts — lower is better), **Questions** (share phrased as questions), **Engagement** (YouTube views / Reddit upvotes), **Sources**, **Specificity**, and an **Opportunity** blend that rewards high demand + low competition. Rising-on-Trends clusters get a bonus.
4. **Write (optional).** AI providers self-activate by key: **Gemini** (`GEMINI_API_KEY`, free), **Groq** (`GROQ_API_KEY`, free), **Claude** (`ANTHROPIC_API_KEY`, paid). With one, it writes the copy; with two or more it runs **compare + pick best** (each model writes ideas, the most capable judges/merges). Models only write titles/descriptions/outlines — never the numbers.

5. **Generate the guide (optional).** Click "Generate PDF guide" on any idea → an AI provider writes a full manuscript (intro, 5–8 chapters with tips, conclusion) answering the idea's real queries, and it's rendered into a **designed PDF** (cover, contents, styled chapters, page numbers) with `@react-pdf/renderer` — no paid API, no headless browser, runs on free hosting. `POST /api/guide` with `{ "idea": {...} }` returns the PDF.

Saved ideas and history live in the browser's localStorage. Results and saved ideas export to CSV. Every source and provider is optional and activates only when its key is present.

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
- The Google/YouTube suggest endpoints are unofficial and can rate-limit heavy use.
- The free Google Trends endpoint is flaky (rate-limits); the Apify deep-trends option is reliable but, on Apify's free plan, slow and variable (~30–60s, occasional timeouts). A paid Apify plan makes it fast/consistent.
- X (Twitter), Threads, Quora and Facebook have no free, legitimate search API and are not included.
