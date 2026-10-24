# MarketingAgent — AI digital marketing platform

One AI agent for a business's whole digital marketing: set up a **Brand Kit** once, type a **theme**, and the agent plans the content calendar and writes every post (caption, hashtags, image prompt, SEO keywords) for each platform, ready for review and approval.

Multi-tenant SaaS from day one: every signup gets its own workspace. **Phase 1** runs entirely on free AI tiers with free-plan limits (4 business accounts per workspace). **Phase 2** adds credits and billing.

## Run it locally (no database or API key needed)

```bash
npm install
cp .env.example .env.local
# For a demo without any API key, set AGENT_TEXT_CHAIN=fake in .env.local
npm run dev
```

Open http://localhost:3000, sign up, add a business account, create a campaign.

To use real AI, add free keys to `.env.local`:

- `GEMINI_API_KEY`: https://aistudio.google.com/apikey
- `GROQ_API_KEY`: https://console.groq.com/keys

then set `AGENT_TEXT_CHAIN=gemini,groq`. The router tries Gemini first and falls back to Groq.

The app stores data in an embedded Postgres (PGlite) in `./.data` when `DATABASE_URL` is empty. Delete that folder to start fresh.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app in development |
| `npm test` | Run the test suite (in-memory database, fake AI) |
| `npm run typecheck` | TypeScript check |
| `npm run build && npm start` | Production build and server |
| `npm run worker` | Background job worker (production, needs Postgres) |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |

## Production (DigitalOcean droplet)

1. Create a Postgres database and set `DATABASE_URL=postgres://...`.
2. Set `SESSION_SECRET` (32+ random characters) and the AI keys.
3. `npm ci && npm run build`.
4. Run `npm start` (web) and `npm run worker` (jobs) with `AGENT_INLINE_JOBS=false`, e.g. under pm2 or systemd.

Migrations run automatically on start.

## How it is built

```
src/
  app/                 Next.js App Router pages + server actions
    (app)/dashboard    usage meters, recent campaigns, AI activity log
    (app)/brands       business accounts + Brand Kit
    (app)/campaigns    theme -> plan -> posts, review/approve/edit/rewrite
  agent/
    router.ts          Model Router: quota checks, provider fallback, logging
    providers/         gemini, openai-compatible (groq/openrouter/ollama), fake
    brand-context.ts   Brand Kit -> system prompt (the consistency layer)
    planner.ts         theme -> content calendar
    copywriter.ts      post idea -> caption, hashtags, image prompt, SEO keywords
  jobs/                database job queue + handlers (no Redis needed)
  db/                  Drizzle schema + connection (Postgres or embedded PGlite)
  lib/data.ts          data access layer — every query filtered by workspace
scripts/worker.ts      background worker
tests/                 vitest: tenant isolation, limits, router, pipeline
```

**Rules the code follows**

1. Multi-tenant: every query goes through `src/lib/data.ts` and filters by `workspaceId`.
2. Swap-ready: the app calls `generateText()`, never a model directly. Moving from free to paid models = change `AGENT_TEXT_CHAIN` and keys.
3. Everything is logged in `generations` (provider, model, tokens, time, cost) — the numbers for the go/no-go report and for Phase 2 credit pricing.
4. Free-tier safety: per-provider daily caps and per-workspace monthly caps.
5. Human approval before anything is published.

## Phase 1 roadmap (3 weeks)

- [x] Layer 1 — accounts, workspaces, business accounts (Brand Kit), free limits
- [x] Layer 2 — Model Router (Gemini, Groq, OpenRouter, local), campaign planner, copywriter, review/approve
- [ ] Layer 3 — images (Brand Kit visuals, free image models) + asset library
- [ ] Layer 4 — SEO + SMO: keyword/trend suggestions, hashtag sets, best time to post, Google Business Profile posts
- [ ] Layer 5 — tracking: in-app tracker + Google Sheet sync per business account
- [ ] Layer 6 — publishing to Facebook + Instagram (Meta Graph API), analytics pull
- [ ] Layer 7 — client reviewer invites, polish, deploy to droplet
