# Website Intelligence & Audit Tool

Audit any website across Performance, SEO, Accessibility, Security and Best Practices.
npm-workspaces monorepo: `apps/web` (Vite + React), `apps/api` (Express), `apps/worker`
(BullMQ analyzers), `packages/shared` (types, Zod schemas, constants).

> Status: **Milestones 1-6 complete** (architecture; backend; audit infrastructure; analyzers; frontend; lead generation). See the roadmap below.

## Lead generation (Milestone 6)

- **`POST /api/v1/leads`** (name, work email, company, website, message) validates with the shared Zod schema
  (`createLeadSchema`, also used by the web form so both always agree), stores a row in `Lead`, returns `201 { data: { received: true } }`
  (no id and no echo of submitted data).
- **Abuse controls:** dedicated per-IP limit (`LEAD_RATE_LIMIT_MAX`, default 5/window), 10kb body cap, strict schema (unknown fields rejected),
  control characters rejected, and a hidden **honeypot** field: bots that fill it get the same success response and nothing is stored.
- The `website` value is stored as text and never fetched, so it is only syntactically checked. Stored text is rendered only as text.
- **UI:** `/consultation` page with field-level errors, focus on the first invalid field, double-submit protection, a clear confirmation state,
  and server-side field errors mapped back to inputs. Entry points: navbar, footer, and a report-end CTA whose headline uses the audit's real
  count of critical/high issues and pre-fills the audited site.
- **Not included:** email notification. Leads are persisted only; reading them requires DB access. Wiring a mail/CRM webhook is a follow-up
  (needs credentials the project doesn't have).

## Frontend (Milestone 5)

React + Vite + Tailwind v4, themed from the public Cynbit site. Routes: `/` landing + URL form, `/audits/:id`
(processing screen, then the report on the same shareable URL), `/history`, `/compare/:a/:b`.

- **Processing screen** shows only what `/status` returns: per-category state and "N of 5 checks finished" from persisted
  rows. No simulated progress.
- **Report**: overall health ring, issue/critical/warning/passed stats, per-category scores and chart, "Fix these first"
  (ranked with the scoring weights), then a section per category with severity / category / status filters.
  Copy link; **Download PDF** uses the browser's print-to-PDF with a print stylesheet that expands every finding.
- **Unavailable is not zero**: unavailable categories render "N/A" with their reason and are excluded from the overall score.
- **History is per browser.** There are no accounts, so "my audits" are the ids kept in `localStorage`, and the API refuses to
  list audits without explicit ids (`GET /audits?ids=…`), so nobody can enumerate other visitors' URLs.
- **Compare** (`GET /audits/compare/:a/:b`) shows score deltas plus fixed / new / still-open issues, and never reports a
  category that was unavailable in one audit as "fixed" or "regressed".
- Audited-site content (titles, evidence, snippets) is only ever rendered as React text, never as HTML.
> Docs: [deployment (Vercel + Render)](docs/deployment.md) · [scoring model](docs/scoring.md) · [security / SSRF design](docs/security.md) · [analyzers](docs/analyzers.md)

## Analyzers (Milestone 4)

Performance (PageSpeed Insights), SEO (Cheerio), Accessibility (Playwright + axe-core), Security (headers/cookies/TLS) and
Best Practices (assets + Lighthouse). Details, honesty rules and limitations: [docs/analyzers.md](docs/analyzers.md).

- **PageSpeed key:** set `PAGESPEED_API_KEY`. Without it, Performance is reported *unavailable* (never faked).
- **Browser:** the Accessibility analyzer needs Chromium: `npx playwright-core install chromium`.
  Without it that category is reported *unavailable*.

## Audit infrastructure (Milestone 3)

- **`packages/net-guard`**: the only code allowed to contact target sites. URL normalisation, IP deny-lists
  (IPv4+IPv6), DNS validation, a connection-time guarded `lookup` (anti-rebinding) and `safeFetch`
  (redirect re-validation, timeouts, size caps). 150 tests.
- **API**: `POST /api/v1/audits` (202 + audit id), `GET /audits`, `/audits/:id`, `/audits/:id/status`
  (real progress from persisted category states), `/audits/:id/report`. Stricter per-IP limit on submissions.
- **Worker**: BullMQ consumer -> `runAudit` orchestrator. Analyzers run independently with per-analyzer
  timeouts; each result is saved as it lands; partial results are first-class; retries resume instead of redoing work.
- **Compare endpoint** (`/audits/compare/:a/:b`) ships with the history UI in Milestone 5.
> Not yet verified against live Postgres/Redis (Docker was unavailable): run
> `npm run infra:up && npm run db:migrate`, then `GET /api/v1/health` should report both `up`.

## Backend foundation (Milestone 2)

- **Prisma schema** (`prisma/schema.prisma`): Audit, AuditCategory, AuditFinding, Lead, with enums,
  cascade deletes, `@@unique([auditId, category])` and indexes for history queries. Initial SQL migration
  is in `prisma/migrations/`. DB enums are SCREAMING_SNAKE; `apps/api/src/utils/enum-map.ts` maps them
  to the shared contract and a test fails if they drift.
- **Errors:** one `AppError` type + central handler. Clients get `{ error: { code, message, requestId } }`;
  unexpected errors become a generic 500 and are logged server-side only.
- **Validation:** `validate({ params, query, body })` middleware (Zod) replaces request data with parsed values.
- **Hardening:** Helmet, exact-match CORS allowlist, 10kb body limit, per-IP rate limit (health exempt).
- **Health:** `/api/v1/health` probes Postgres and Redis with a 2s timeout; 503 when degraded.
- **Queue:** BullMQ `audit` queue (2 attempts, exponential backoff, bounded job retention).

## Quick start

```bash
cp .env.example .env
npm install
npm run infra:up        # Postgres + Redis (requires Docker running)
npm run dev:api         # http://localhost:4000/api/v1/health
npm run dev:worker
npm run dev:web         # http://localhost:5173
npm run typecheck && npm test && npm run build
```

## Decisions

- **Shared package ships TypeScript source.** Vite and tsx consume it directly; api/worker
  production builds bundle it via `tsup` (`noExternal`). No separate build step to keep in sync.
- **Env validated with Zod at startup** in each app (fail fast, readable errors).
- **Analyzer contract** (`AnalyzerResult`) has `score: number | null`; "unavailable" is a
  distinct status, never a fabricated zero.
- **Design tokens** in `apps/web/src/index.css` mirror the public Cynbit site (cynbit.in):
  teal `#006067` primary, Material-3 surface scale, Plus Jakarta Sans / Manrope, rounded surfaces.

## Roadmap

1. Repo & architecture (done) 2. Backend foundation (Prisma, Redis, errors, health)
3. Audit infrastructure (SSRF, queue, orchestrator) 4. Analyzers 5. Frontend
6. Leads (done) 7. Testing, Docker images, deployment docs
