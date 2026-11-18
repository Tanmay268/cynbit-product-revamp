import { SafeFetchError, type SafeFetch } from '@wi/net-guard';

export interface RoutedRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
}
export interface RouteLike {
  fulfill(options: { status: number; headers: Record<string, string>; body?: Buffer }): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

/** Hop-by-hop / encoding headers that no longer describe the (already decoded) body we hand back. Cookies are never set. */
const DROP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie', 'set-cookie2']);
const FORWARD_REQUEST_HEADERS = ['accept', 'accept-language'];

/**
 * Serves EVERY browser request through safeFetch instead of letting Chromium touch the network itself.
 *
 * Why: Playwright's `route.continue()` lets Chromium resolve DNS and follow redirects on its own,
 * which (a) cannot pin the connection to a validated address (DNS rebinding) and (b) does NOT
 * re-run the route handler for redirect targets (verified against a real browser: a 302 to an internal
 * address was followed). Going through safeFetch gives the browser the same guarantees as every other
 * outbound request: validated scheme/port/host, connection-time DNS validation, size and time caps.
 *
 * Redirects are followed INSIDE safeFetch (each hop re-validated) and Chromium only ever receives the final
 * response. They must not be handed back to the browser: verified against real Chrome, a 302 delivered via
 * route.fulfill is followed by Chromium without re-entering the route handler, which would bypass the guard.
 * (Trade-off: after a cross-host redirect the page's URL is still the original one.)
 *
 * Behavioural limits, acceptable for an audit crawl: only GET/HEAD are served (no form posts or beacons),
 * and cookies are not carried or set.
 */
export async function handleBrowserRequest(req: RoutedRequest, route: RouteLike, fetch: SafeFetch): Promise<void> {
  const method = req.method().toUpperCase();
  try {
    if (method !== 'GET' && method !== 'HEAD') return await route.abort('blockedbyclient');

    const headers: Record<string, string> = {};
    const incoming = req.headers();
    for (const name of FORWARD_REQUEST_HEADERS) if (incoming[name]) headers[name] = incoming[name];

    const res = await fetch(req.url(), { method, headers });

    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(res.headers)) {
      if (DROP_RESPONSE_HEADERS.has(name)) continue;
      out[name] = Array.isArray(value) ? value.join(', ') : value;
    }
    await route.fulfill({ status: res.status, headers: out, body: method === 'HEAD' ? undefined : res.body });
  } catch (err) {
    // Blocked destinations are reported as such; everything else as a generic network failure.
    const code = err instanceof SafeFetchError && err.code === 'BLOCKED' ? 'blockedbyclient' : 'failed';
    await route.abort(code).catch(() => undefined); // page/context may already be closed
  }
}
