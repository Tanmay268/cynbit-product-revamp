# Deployment: Vercel (web) + Render (API, worker, Postgres, Redis)

> Status: the files below are prepared and the pieces that can be checked offline were checked (typecheck, tests, builds,
> `npm ci` of the per-app workspace graph). **The Docker images and the Render/Vercel deploys themselves have not been run**,
> because Docker was unavailable on the development machine and no accounts were used. Follow the verification list at the end.

## What goes where

| Piece | Host | Defined in |
|---|---|---|
| `apps/web` (static SPA) | Vercel | `vercel.json` |
| `apps/api` (Express) | Render web service (Docker) | `render.yaml`, `apps/api/Dockerfile` |
| `apps/worker` (BullMQ + Chromium) | Render background worker (Docker) | `render.yaml`, `apps/worker/Dockerfile` |
| PostgreSQL | Render Postgres | `render.yaml` |
| Redis | Render Key Value (`maxmemoryPolicy: noeviction`) | `render.yaml` |

The app lives at the repository root, so both hosts use their default root directory.

## 1. Render (do this first: you need the API URL for Vercel)

1. Push the repository to GitHub/GitLab.
2. Render dashboard: **New > Blueprint**, select the repo (`render.yaml` is picked up from the repository root).
3. When prompted for `sync: false` values:
   - `PAGESPEED_API_KEY`: your Google key (PageSpeed Insights API enabled). Without it Performance is reported *unavailable*.
   - `CORS_ORIGINS`: your Vercel origin, exact match, no trailing slash (e.g. `https://your-app.vercel.app`). If you don't know it yet, put a placeholder and update it after step 2.
4. Apply. The API container runs `prisma migrate deploy` on every start (idempotent), then serves on port 10000.
5. Note the API URL, e.g. `https://wi-api.onrender.com`. Check `https://<api>/api/v1/health` returns `status: ok` with database and redis `up`.

**Plans and cost.** Render has no free background worker, and headless Chromium needs roughly 1-2 GB of RAM, so the blueprint uses a
`standard` worker. A smaller plan will be OOM-killed during Accessibility audits (the category would show failed/unavailable, never a fake score).
Adjust plans in `render.yaml` to your budget; check current pricing on Render.

## 2. Vercel

1. **Add New > Project**, import the same repo.
2. **Root Directory:** leave the default (repository root). The settings come from `vercel.json`: install `npm ci`, build `npm run build -w @wi/web`, output `apps/web/dist`, SPA rewrite so `/audits/:id` deep links work.
3. **Environment variable:** `VITE_API_BASE_URL` = `https://<your-api>.onrender.com/api/v1` (Production and Preview). Vite inlines it at build time, so redeploy after changing it.
4. Deploy, then put the final Vercel origin into Render's `CORS_ORIGINS` (and redeploy the API). Preview deployments use different origins; add them if you test previews against the real API.

## 3. After deploying: verification checklist

- [ ] `GET /api/v1/health` is `ok` (database + redis up).
- [ ] From the Vercel site, analyze a real public site; processing screen advances and a report appears.
- [ ] Accessibility category completes (proves Chromium works in the worker). If it says unavailable, read the worker log for the launch error.
- [ ] Performance completes (proves `PAGESPEED_API_KEY`).
- [ ] Submit the consultation form; confirm a row appears in the `Lead` table.
- [ ] Try `http://169.254.169.254` and `http://localhost` as targets: both must be rejected.
- [ ] **Rate-limit client IP** (see below).
- [ ] Browser console on the live site: no CORS errors.

### TRUST_PROXY_HOPS: verify it
The API default is `0` (trust no proxy; a client-supplied `X-Forwarded-For` is ignored). `render.yaml` sets `1`, which is right only if exactly one proxy sits in front of the service.
Rate limiting keys on `req.ip`. Express derives it from `X-Forwarded-For` using the number of trusted proxy hops.
Too low: all users share the proxy's IP and get limited together. Too high: clients can spoof their IP and dodge limits.
Render puts at least one proxy in front of your service, and may add more (e.g. a CDN layer), so don't assume.
To verify: with `AUDIT_RATE_LIMIT_MAX` temporarily low, send requests from two different networks and confirm they are limited independently,
and that sending a forged `X-Forwarded-For` header does not reset your limit. Adjust `TRUST_PROXY_HOPS` accordingly.

## Security notes specific to this deployment

- **Chromium sandbox is disabled on Render** (`BROWSER_NO_SANDBOX=true`) because containers there generally lack user namespaces.
  Compensating controls: all browser requests go through net-guard, the worker's only secrets are DB/Redis URLs (private network),
  and it runs as a non-root user. For stricter isolation, run the worker on a host that allows the sandbox and set it to `false`.
- **Network-level SSRF controls.** Application code blocks private/metadata addresses (see `security.md`). Where the host allows it, also restrict worker egress to public IPs.
- Keep Postgres and Redis on Render's private network (the blueprint uses internal connection strings and an empty Redis allow-list).
- Secrets live only in Render/Vercel environment settings. The only value in the web bundle is `VITE_API_BASE_URL`, which is public by nature.
- The in-memory rate limiter is per process. If you scale the API to more than one instance, switch it to a Redis-backed store.

## Local equivalent of production

```bash
docker compose up -d postgres redis                    # infra only (normal development)
docker compose --profile app up --build                # also build and run the api + worker images
```
