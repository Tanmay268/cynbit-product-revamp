import type { PageSpeedData, PageSpeedOutcome } from '../analyzers/types.js';

export interface PageSpeedConfig {
  apiKey?: string;
  /** Test seam; defaults to global fetch. The endpoint is a fixed trusted Google host, never user-controlled. */
  fetchImpl?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
  /** Delay before the single retry on a 5xx. */
  retryDelayMs?: number;
}

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

const fail = (reason: Extract<PageSpeedOutcome, { ok: false }>['reason'], message: string): PageSpeedOutcome => ({ ok: false, reason, message });

/**
 * Creates the PageSpeed Insights loader used by the Performance and Best Practices analyzers.
 *
 * Security notes:
 *  - The API key is sent as a query parameter because Google requires it. The request URL is NEVER logged
 *    and never appears in an error message (messages below are fixed strings).
 *  - Google, not this server, fetches the target site, but the target URL was still validated upstream.
 */
export function createPageSpeedLoader(config: PageSpeedConfig) {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 75_000;

  return async function loadPageSpeed(targetUrl: string, signal?: AbortSignal): Promise<PageSpeedOutcome> {
    if (!config.apiKey) return fail('missing-key', 'The PageSpeed Insights API key is not configured on the server.');

    const params = new URLSearchParams({ url: targetUrl, strategy: 'mobile', key: config.apiKey });
    params.append('category', 'performance');
    params.append('category', 'best-practices');
    const requestUrl = `${config.endpoint ?? ENDPOINT}?${params.toString()}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const deadline = AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        res = await doFetch(requestUrl, { signal: signal ? AbortSignal.any([deadline, signal]) : deadline });
      } catch (err) {
        const timedOut = deadline.aborted || (err as { name?: string })?.name === 'TimeoutError' || (err as { name?: string })?.name === 'AbortError';
        return timedOut ? fail('timeout', 'PageSpeed Insights took too long to analyze this page.') : fail('unavailable', 'PageSpeed Insights could not be reached.');
      }

      if (res.status === 429) return fail('rate-limited', 'The PageSpeed Insights quota has been reached. Try again later.');
      if (res.status === 401 || res.status === 403) return fail('invalid-key', 'The PageSpeed Insights API key was rejected or the API is not enabled for it.');
      if (res.status >= 500) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, config.retryDelayMs ?? 1_500));
          continue;
        }
        return fail('unavailable', 'PageSpeed Insights is temporarily unavailable.');
      }
      if (res.status === 400) return fail('target-failed', 'PageSpeed Insights could not load this page.');
      if (!res.ok) return fail('unavailable', 'PageSpeed Insights returned an unexpected response.');

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return fail('bad-response', 'PageSpeed Insights returned an unreadable response.');
      }
      return parse(body);
    }
    return fail('unavailable', 'PageSpeed Insights is temporarily unavailable.');
  };
}

/** Validates the parts of the response we rely on; anything else is a bad response, never a guess. */
export function parse(body: unknown): PageSpeedOutcome {
  const b = body as Partial<PageSpeedData> | null;
  const lh = b?.lighthouseResult;
  if (!lh || typeof lh !== 'object' || !lh.categories || typeof lh.audits !== 'object') {
    return fail('bad-response', 'PageSpeed Insights returned an unexpected response.');
  }
  // Lighthouse reports a runtime error (e.g. page timed out) instead of scores.
  const perf = lh.categories['performance'];
  if (!perf || typeof perf.score !== 'number') {
    return fail('target-failed', 'PageSpeed Insights could not measure this page.');
  }
  return { ok: true, data: { lighthouseResult: lh, loadingExperience: b?.loadingExperience } };
}
