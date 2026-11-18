# Security design: SSRF and untrusted input

Users submit arbitrary URLs and our servers fetch them, which is the textbook SSRF setup. All outbound
access to target sites goes through one audited module, [`packages/net-guard`](../packages/net-guard).

## Defence in depth

| # | Layer | Where | What it stops |
|---|-------|-------|---------------|
| 1 | URL normalisation | `normalizeUrl` | Non-http(s) schemes, credentials in URLs, non-80/443 ports, `localhost`/`.internal`/`.local` names, single-label hosts, and every encoding of a private IP (`2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1`, `[::ffff:7f00:1]` are all canonicalised by the WHATWG parser, then range-checked) |
| 2 | DNS validation at submission | `AuditService.create` | Fast user feedback; hostnames that resolve to private space are rejected before anything is queued. **Every** returned record must be public (mixed answers rejected) |
| 3 | Re-validation in the worker | `runAudit` | The queue is not trusted. The URL is normalised and resolved again immediately before any analyzer runs |
| 4 | Connection-time guard | `createGuardedLookup` | **DNS rebinding.** The socket connects to the exact address the guarded `lookup` returns, and that function validates it. There is no separate "check" resolution that can differ from the "use" resolution |
| 5 | Redirect re-validation | `createSafeFetch` | Every hop (max 5) goes through layers 1 and 4 again, so `public.example -> http://169.254.169.254/` is blocked |
| 6 | Resource limits | `createSafeFetch` | 15s wall-clock budget, 10s idle-socket timeout, 32 KB header cap, 5 MiB cap on **decompressed** bytes (gzip/brotli bombs), fresh connection per hop (`agent: false`), no proxy, no cookies or `Authorization` ever sent |
| 7 | Safe errors | all layers | User-facing messages never include IPs, resolver errors or stack traces; details are logged server-side with a request id |

## Blocked ranges (`ip.ts`)

IPv4: `0/8 10/8 100.64/10 127/8 169.254/16 172.16/12 192.0.0/24 192.0.2/24 192.88.99/24 192.168/16 198.18/15 198.51.100/24 203.0.113/24 224/4 240/4`
IPv6: `::/128 ::1/128 64:ff9b::/96 64:ff9b:1::/48 100::/64 2001::/23 2001:db8::/32 2002::/16 fc00::/7 fe80::/10 fec0::/10 ff00::/8`, plus every IPv4-mapped address (`::ffff:0:0/96`), detected explicitly.
Cloud metadata is covered structurally: AWS/GCP/Azure/DO `169.254.169.254` (link-local), AWS IPv6 `fd00:ec2::254` (ULA), Alibaba `100.100.100.200` (CGNAT).
Anything that is not a parseable IP is blocked (fail closed).

## Known limits and required infrastructure controls

Application-level checks are necessary but not sufficient. Production must also:

1. **Egress firewall the worker.** Deny outbound traffic to RFC1918, link-local and metadata ranges at the network layer
   (security group / VPC egress rules / NetworkPolicy). This backstops any bug above, including ones in a browser engine.
2. **Enforce IMDSv2 / disable the metadata service** on the hosts that run the API and worker.
3. **Run the Playwright worker in a locked-down container:** non-root, read-only root FS, no extra capabilities,
   seccomp default, memory/CPU limits, ephemeral browser profile. Keep Chromium's sandbox ON (`BROWSER_NO_SANDBOX=false`);
   only set it to `true` when the container cannot grant the sandbox its kernel features.

   **How the browser is constrained (`browser-routing.ts`).** Chromium never touches the network itself. Every request it
   makes is intercepted and served through `safeFetch` (validated scheme/port/host, connection-time DNS pinning, size and
   time caps) and the response is handed back to the page. Only GET/HEAD are served; WebSockets, service workers, downloads
   and permission prompts are blocked; each audit runs in a throwaway context that is destroyed on completion or abort.

   **Found by testing against real Chrome:** an earlier design used `route.continue()` plus a hostname check. A server-side 302
   to an internal address was followed by Chromium without re-entering the route handler, bypassing the check. Returning
   the 302 via `route.fulfill` had the same problem. The fix is to follow redirects inside `safeFetch`, re-validating every
   hop, and give the browser only the final response. The regression test is `browser.e2e.test.ts`.

   The egress firewall in (1) is still required: it covers anything that does not go through the interception layer
   (e.g. WebRTC, or a Chromium bug).
4. **Terminate TLS at a trusted proxy** and keep `trust proxy` at the exact hop count so rate limiting sees real client IPs.
5. **Use a Redis-backed rate-limit store** if the API is horizontally scaled (the default store is per process).
6. Keep secrets (`PAGESPEED_API_KEY`, DB/Redis URLs) in the platform secret store, never in the web bundle.

## What is NOT claimed

- The Security analyzer reports missing headers as *findings*, never as confirmed vulnerabilities, and never states a site is "secure".
- Port restriction to 80/443 is a deliberate trade-off: it blocks probing of internal services on odd ports but means sites
  served only on custom ports cannot be audited.

---

## Pre-deployment verification (local, against real Postgres, Redis, Chromium and Docker)

Run before the first deploy. Everything below was executed, not assumed.

**Automated:** typecheck clean; builds pass; tests: net-guard 155, API 70, worker 141 (incl. 3 real-Chrome), web 99, shared 11.

**Live browser walkthrough (real Chrome, real API/DB/worker), 42 checks:** landing sections; URL validation; internal/non-http URLs refused with
friendly messages; a real audit through processing to the report; filters, expand, copy link, print stylesheet; shareable link in a fresh browser;
second audit, history and compare; unknown/malformed ids; 404; consultation form (validation, success, hostile text not executed);
no horizontal overflow on mobile for four pages; keyboard focus; no console errors or 5xx.

**Live API security probes:**
- ~45 SSRF forms all refused (422): localhost variants, decimal/hex/octal/short IPv4, IPv6 loopback and IPv4-mapped IPv6, link-local/metadata
  (including `metadata.google.internal`), RFC1918/CGNAT/benchmark ranges, DNS names that resolve to loopback (`localtest.me`, `*.nip.io`),
  `user@host` / `host@127.0.0.1` / `#@` tricks, non-standard ports (22, 6379, 8080, 5432), and `ftp:`/`gopher:`/`data:`/`file:`/`javascript:`.
- Helmet headers present (CSP, HSTS, nosniff, frame, referrer, COOP/CORP), no `X-Powered-By`; CORS reflects only the allowlisted origin.
- Malformed JSON, wrong content-type, unknown fields, array/object `url`, `__proto__`, oversize URL/body, SQL-injection and traversal in ids,
  more than 50 ids: all rejected with a 4xx and a safe error envelope. Hostile text in the lead form is stored as inert text; tables intact.
- `GET /audits` without explicit ids is refused (no enumeration of other visitors' URLs).
- Rate limits return 429 with `Retry-After`: audits 5/min, leads 5/min.

**Defects found by this pass and fixed (each with a regression test):**
1. *Status polling shared the general 60/min budget*, so two audits in a minute (or two users behind one NAT) were throttled. Polling now has its own
   limit (`STATUS_RATE_LIMIT_MAX`, default 300/min) and no longer consumes the general budget.
2. *Forged `X-Forwarded-For` bypassed rate limits when `TRUST_PROXY_HOPS` was 1 with no proxy in front.* Default is now 0 (trust nothing);
   Render's blueprint sets 1 explicitly. Verify per host, see `deployment.md`.
3. *Line breaks were accepted in single-line lead fields* (future email-header injection). Single-line fields now reject control characters.
4. The Security section now always states "hardening gaps, not confirmed vulnerabilities" instead of only inside an info finding hidden by the default filter.

**Docker:** both images build; API container runs as non-root, applies migrations on start, and migrates an empty database from scratch; the
worker container runs as non-root and completes real 5-category audits with the browser sandbox both on and off.

## Known issues and accepted risks

- **Dependencies (`npm audit`: 14, none auto-fixable without breaking changes).**
  - *Runtime:* `zod` < 4.6.6 (memory exhaustion on huge constrained arrays). Mitigated: request bodies are capped at 10 KB and `ids` at 50 items,
    so oversized collections cannot reach validation. Fix is the Zod 3 to 4 major migration; schedule it after launch.
  - *Migration CLI:* `prisma` to `deepmerge-ts` (stack exhaustion when merging attacker-controlled objects). Only our own config is merged. Needs Prisma 7.
  - *Build/test tooling only (not shipped, not reachable from the internet):* `vitest`/`tinypool` (reported critical), `vite`, `tsup`, `picomatch`, `tinyglobby`.
- **Redirect-to-internal could not be exercised live**: public redirect services refuse internal targets themselves. It is covered by the net-guard tests
  (real local servers and redirect chains) and the real-Chrome browser test.
- **No end-to-end test of the Render/Vercel environments yet** (proxy hop count, Chromium sandbox on Render, CORS with the real Vercel origin).
- Docker images are not slimmed (1.2 GB API, 2.7 GB worker); builds are slower but not less secure.
- Report links are unguessable-UUID capability links, not authenticated.
