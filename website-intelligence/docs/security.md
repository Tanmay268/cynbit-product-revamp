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
