import { SafeFetchError, type SafeFetchResponse } from '@wi/net-guard';
import type { AnalyzerResult, Finding } from '@wi/shared';
import type { AnalyzerContext, PageSpeedOutcome } from './types.js';

export function makeResponse(over: Partial<SafeFetchResponse> & { html?: string } = {}): SafeFetchResponse {
  const { html, ...rest } = over;
  return {
    url: 'https://example.com/',
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: Buffer.from(html ?? '<!doctype html><html lang="en"><head><title>T</title></head><body></body></html>'),
    truncated: false,
    redirects: [],
    durationMs: 10,
    ...rest,
  };
}

type Route = Partial<SafeFetchResponse> | SafeFetchError | ((method: string) => Partial<SafeFetchResponse> | SafeFetchError);

export interface TestCtx extends AnalyzerContext {
  /** "METHOD url" for every request the analyzer made through ctx.fetch. */
  requests: string[];
}

/**
 * Builds a fake AnalyzerContext. `routes` maps full URLs (or paths) to canned responses;
 * unknown URLs return 404. No real network is ever touched.
 */
export function makeCtx(
  opts: {
    url?: string;
    page?: Partial<SafeFetchResponse> & { html?: string };
    pageError?: Error;
    routes?: Record<string, Route>;
    pagespeed?: PageSpeedOutcome;
  } = {},
): TestCtx {
  const url = opts.url ?? 'https://example.com/';
  const requests: string[] = [];
  const page = makeResponse({ url, ...opts.page });

  return {
    url,
    signal: new AbortController().signal,
    requests,
    page: async () => {
      if (opts.pageError) throw opts.pageError;
      return page;
    },
    pagespeed: async () => opts.pagespeed ?? { ok: false, reason: 'missing-key', message: 'PageSpeed Insights API key is not configured.' },
    fetch: (async (target: string, o?: { method?: string }) => {
      const method = o?.method ?? 'GET';
      requests.push(`${method} ${target}`);
      const u = new URL(target);
      // Most specific first: "METHOD url", "METHOD /path", then "url", then "/path".
      let route = opts.routes?.[`${method} ${target}`] ?? opts.routes?.[`${method} ${u.pathname}`] ?? opts.routes?.[target] ?? opts.routes?.[u.pathname];
      if (typeof route === 'function') route = route(method);
      if (route instanceof SafeFetchError) throw route;
      // A matched route defaults to 200; an unmatched URL is a 404.
      return route ? makeResponse({ url: target, status: 200, html: 'ok', ...route }) : makeResponse({ url: target, status: 404, html: 'not found' });
    }) as AnalyzerContext['fetch'],
  };
}

export const byRule = (r: AnalyzerResult, ruleId: string): Finding => {
  const f = r.findings.find((x) => x.ruleId === ruleId);
  if (!f) throw new Error(`No finding ${ruleId}. Have: ${r.findings.map((x) => x.ruleId).join(', ')}`);
  return f;
};

export const GOOD_PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Acme Widgets | Quality widgets</title>
<meta name="description" content="Acme sells high quality widgets for every purpose, shipped worldwide with a two year warranty.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://example.com/">
<meta property="og:title" content="Acme"><meta property="og:description" content="Widgets"><meta property="og:image" content="https://example.com/og.png">
</head><body>
<h1>Quality widgets</h1><h2>Why Acme</h2><h3>Warranty</h3>
<img src="/logo.png" alt="Acme logo">
<a href="/products">Our products</a> <a href="/about">About us</a>
</body></html>`;
