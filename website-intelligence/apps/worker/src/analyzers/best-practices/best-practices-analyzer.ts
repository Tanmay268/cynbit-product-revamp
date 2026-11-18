import * as cheerio from 'cheerio';
import { SafeFetchError, type SafeFetchResponse } from '@wi/net-guard';
import type { Finding } from '@wi/shared';
import type { Analyzer, AnalyzerContext } from '../types.js';
import { buildResult, check, failed, header, mapLimit, outcome, passed, truncate, warning, type Rule } from '../common.js';

const R = {
  mixed: {
    ruleId: 'best-practices.mixed-content',
    title: 'No insecure (HTTP) resources on an HTTPS page',
    description: 'Loading scripts, styles, frames or images over http:// from an https:// page is blocked or flagged by browsers and weakens the page’s security.',
    severity: 'high',
    recommendation: 'Change every http:// resource URL to https:// (or protocol-relative paths) and make sure the host supports HTTPS.',
    impact: 'Blocked resources break functionality; insecure ones can be tampered with in transit.',
  },
  broken: {
    ruleId: 'best-practices.broken-resources',
    title: 'Referenced resources load successfully',
    description: 'Scripts, stylesheets and images referenced by the page should respond without 4xx/5xx errors. A sample of up to 12 is checked.',
    severity: 'high',
    recommendation: 'Fix the URLs or remove references to files that no longer exist.',
    impact: 'Missing scripts or styles break the page and every failed request wastes time.',
  },
  caching: {
    ruleId: 'best-practices.static-caching',
    title: 'Static assets use long-lived caching',
    description: 'Same-origin scripts, styles and images should send Cache-Control with a max-age of at least 7 days (use fingerprinted file names).',
    severity: 'medium',
    recommendation: 'Send "Cache-Control: public, max-age=31536000, immutable" for fingerprinted static assets.',
    impact: 'Repeat visitors re-download files they already have, slowing every page view.',
  },
  compression: {
    ruleId: 'best-practices.compression',
    title: 'Text resources are compressed',
    description: 'HTML, CSS, JavaScript and SVG larger than ~1.4 KB should be served with gzip or Brotli.',
    severity: 'medium',
    recommendation: 'Enable Brotli or gzip compression on your server or CDN for text-based responses.',
    impact: 'Compression typically cuts transfer size by 60-80%.',
  },
  size: {
    ruleId: 'best-practices.resource-size',
    title: 'No excessively large resources',
    description: 'Individual resources over 1 MB (images over 500 KB) noticeably slow page loads, especially on mobile.',
    severity: 'medium',
    recommendation: 'Compress, resize or split large files; lazy-load images and code that is not needed immediately.',
    impact: 'Large downloads delay rendering and consume visitors’ data.',
  },
  imageFormat: {
    ruleId: 'best-practices.image-formats',
    title: 'Large images use modern formats',
    description: 'PNG/JPEG/GIF images above 100 KB are usually much smaller as WebP or AVIF.',
    severity: 'low',
    recommendation: 'Serve WebP or AVIF (with a fallback if needed) for photographic and large images.',
    impact: 'Modern formats are commonly 25-50% smaller at the same quality.',
  },
  imageDimensions: {
    ruleId: 'best-practices.image-dimensions',
    title: 'Images declare width and height',
    description: 'Explicit dimensions let the browser reserve space before the image loads.',
    severity: 'low',
    recommendation: 'Add width and height attributes (or CSS aspect-ratio) to every <img>.',
    impact: 'Missing dimensions cause layout shifts while the page loads.',
  },
  redirects: {
    ruleId: 'best-practices.redirects',
    title: 'Redirect chain is short',
    description: 'Each redirect adds a full network round trip before the page can start loading.',
    severity: 'medium',
    recommendation: 'Link directly to the final URL and collapse multi-step redirects into a single hop.',
    impact: 'Every extra redirect delays first paint, particularly on mobile networks.',
  },
  doctype: {
    ruleId: 'best-practices.doctype',
    title: 'Page declares an HTML5 doctype',
    description: 'Without <!doctype html> browsers render in quirks mode, which causes inconsistent layout.',
    severity: 'medium',
    recommendation: 'Start the document with <!doctype html>.',
    impact: 'Quirks mode produces unpredictable rendering differences between browsers.',
  },
  charset: {
    ruleId: 'best-practices.charset',
    title: 'Character encoding is declared',
    description: 'A charset declaration (HTTP header or <meta charset>) prevents garbled text.',
    severity: 'low',
    recommendation: 'Add <meta charset="utf-8"> as early as possible in <head>.',
    impact: 'Text may render incorrectly or trigger encoding-based bugs.',
  },
  documentCaching: {
    ruleId: 'best-practices.document-caching',
    title: 'HTML response has cache validators',
    description: 'ETag or Last-Modified (or Cache-Control) lets browsers revalidate cheaply instead of re-downloading the page.',
    severity: 'low',
    recommendation: 'Send ETag or Last-Modified, and a Cache-Control policy appropriate for the page.',
    impact: 'Cheaper repeat visits and lower server load.',
  },
  truncated: {
    ruleId: 'best-practices.document-size',
    title: 'HTML document is a reasonable size',
    description: 'The HTML response was larger than the analysis size limit and was truncated.',
    severity: 'medium',
    recommendation: 'Reduce the HTML payload: paginate long lists, remove inline data blobs and avoid duplicate markup.',
    impact: 'Huge documents delay parsing and first render.',
  },
  lighthouseUnavailable: {
    ruleId: 'best-practices.lighthouse-unavailable',
    title: 'Lighthouse best-practice insights',
    description: 'Extra browser-level checks (console errors, deprecated APIs, image aspect ratios…) come from PageSpeed Insights.',
    severity: 'info',
    recommendation: 'Configure PAGESPEED_API_KEY to include them.',
  },
} satisfies Record<string, Rule>;

/**
 * Lighthouse best-practice audits we adopt. Deliberately excludes the ones our own analyzers already
 * cover (is-on-https, doctype, charset, csp-xss, has-hsts, clickjacking-mitigation…) so nothing is reported twice.
 */
const LIGHTHOUSE_AUDITS = [
  'errors-in-console',
  'deprecations',
  'third-party-cookies',
  'image-aspect-ratio',
  'image-size-responsive',
  'inspector-issues',
  'geolocation-on-start',
  'notification-on-start',
  'paste-preventing-inputs',
] as const;

const TEXT_TYPE = /(html|css|javascript|ecmascript|json|xml|svg|text\/)/i;
const MAX_SAMPLE = 12;

interface Asset {
  url: string;
  kind: 'script' | 'style' | 'image';
  sameOrigin: boolean;
}
type Probed = { asset: Asset; res: SafeFetchResponse } | { asset: Asset; error: SafeFetchError };

export const bestPracticesAnalyzer: Analyzer = {
  category: 'best-practices',
  async run(ctx) {
    const started = Date.now();
    const page = await ctx.page();
    const findings: Finding[] = [];

    const html = page.body.toString('utf8');
    const $ = cheerio.load(html);
    const base = new URL(page.url);
    const isHttps = base.protocol === 'https:';

    // Document-level checks
    findings.push(check(R.doctype, /^\s*(?:﻿)?(?:<!--[\s\S]*?-->\s*)*<!doctype\s+html/i.test(html.slice(0, 2000))));
    const hasCharset = $('meta[charset]').length > 0 || /charset=/i.test(header(page.headers, 'content-type') ?? '') || /<meta[^>]+http-equiv=["']?content-type/i.test(html);
    findings.push(check(R.charset, hasCharset));

    const chain = page.redirects.length;
    findings.push(
      chain > 2
        ? warning(R.redirects, `${chain} redirects: ${page.redirects.map((r) => `${r.status} ${r.to}`).join(' → ')}`)
        : passed(R.redirects, chain === 0 ? 'No redirects.' : `${chain} redirect(s): ${page.redirects.map((r) => `${r.status} ${r.to}`).join(' → ')}`),
    );

    const validators = header(page.headers, 'etag') ?? header(page.headers, 'last-modified') ?? header(page.headers, 'cache-control');
    findings.push(check(R.documentCaching, Boolean(validators), validators ? `Validator/policy: ${truncate(validators, 80)}` : 'No ETag, Last-Modified or Cache-Control.'));

    const encoding = header(page.headers, 'content-encoding');
    const docSize = page.body.length;
    if (docSize > 1400) {
      findings.push(check(R.compression, Boolean(encoding && encoding !== 'identity'), encoding ? `HTML served with ${encoding}.` : `HTML (${kb(docSize)}) served without compression.`));
    }
    if (page.truncated) findings.push(failed(R.truncated, 'HTML exceeded the analysis size limit.'));

    // Mixed content (HTML scan)
    if (isHttps) findings.push(mixedContent($));

    // Image dimensions
    const imgs = $('img').toArray();
    if (imgs.length > 0) {
      const noDims = imgs.filter((e) => !(($(e).attr('width') && $(e).attr('height')) || /aspect-ratio|width\s*:|height\s*:/i.test($(e).attr('style') ?? '')));
      findings.push(check(R.imageDimensions, noDims.length === 0, noDims.length ? `${noDims.length} of ${imgs.length} images lack width/height, e.g. ${noDims.slice(0, 3).map((e) => $(e).attr('src') ?? '').join(', ')}` : `${imgs.length} images checked.`));
    }

    // Sampled sub-resource probes
    const assets = collectAssets($, base);
    if (assets.length > 0) findings.push(...resourceFindings(await probe(ctx, assets)));

    // Lighthouse insights (shared PSI call; only audits we do not already cover)
    const ps = await ctx.pagespeed();
    if (ps.ok) {
      for (const id of LIGHTHOUSE_AUDITS) {
        const a = ps.data.lighthouseResult.audits[id];
        if (!a || typeof a.score !== 'number' || a.scoreDisplayMode === 'notApplicable' || a.scoreDisplayMode === 'informative' || a.scoreDisplayMode === 'manual') continue;
        const rule: Rule = {
          ruleId: `best-practices.lighthouse.${id}`,
          title: a.title,
          description: (a.description ?? a.title).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, ''),
          severity: a.score < 0.5 ? 'medium' : 'low',
          recommendation: `Resolve this Lighthouse finding: ${a.title}.`,
          impact: 'Reported by Lighthouse as a best-practice violation.',
        };
        findings.push(a.score >= 1 ? passed(rule) : outcome(rule, a.score < 0.5 ? 'failed' : 'warning', a.displayValue ?? null));
      }
    } else {
      findings.push(outcome(R.lighthouseUnavailable, 'warning', ps.message));
    }

    return buildResult('best-practices', findings, started);
  },
};

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

function mixedContent($: cheerio.CheerioAPI): Finding {
  const active: string[] = [];
  const passive: string[] = [];
  const insecure = (v?: string) => typeof v === 'string' && /^http:\/\//i.test(v.trim());
  $('script[src], iframe[src], embed[src], object[data], link[rel~="stylesheet"][href]').each((_, el) => {
    const v = $(el).attr('src') ?? $(el).attr('data') ?? $(el).attr('href');
    if (insecure(v)) active.push(v!.trim());
  });
  $('img[src], source[src], video[src], audio[src]').each((_, el) => {
    const v = $(el).attr('src');
    if (insecure(v)) passive.push(v!.trim());
  });
  if (active.length) return failed(R.mixed, `${active.length} active insecure resource(s) (blocked by browsers): ${active.slice(0, 3).join(', ')}`);
  if (passive.length) return warning(R.mixed, `${passive.length} insecure image/media resource(s): ${passive.slice(0, 3).join(', ')}`);
  return passed(R.mixed);
}

function collectAssets($: cheerio.CheerioAPI, base: URL): Asset[] {
  const seen = new Set<string>();
  const out: Asset[] = [];
  const add = (raw: string | undefined, kind: Asset['kind']) => {
    if (!raw || /^(data:|blob:|javascript:|#)/i.test(raw.trim())) return;
    try {
      const u = new URL(raw.trim(), base);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      u.hash = '';
      if (seen.has(u.href)) return;
      seen.add(u.href);
      out.push({ url: u.href, kind, sameOrigin: u.hostname === base.hostname });
    } catch {
      /* ignore unparsable URLs */
    }
  };
  $('script[src]').each((_, e) => add($(e).attr('src'), 'script'));
  $('link[rel~="stylesheet"][href]').each((_, e) => add($(e).attr('href'), 'style'));
  $('img[src]').each((_, e) => add($(e).attr('src'), 'image'));
  // Prioritise scripts and styles (break the page), then images; cap total requests.
  return out.slice(0, MAX_SAMPLE);
}

async function probe(ctx: AnalyzerContext, assets: Asset[]): Promise<Probed[]> {
  return mapLimit(assets, 4, async (asset): Promise<Probed> => {
    try {
      let res = await ctx.fetch(asset.url, { method: 'HEAD', timeoutMs: 8_000, maxRedirects: 3, signal: ctx.signal });
      if (res.status === 405 || res.status === 501) res = await ctx.fetch(asset.url, { method: 'GET', maxBytes: 1, timeoutMs: 8_000, maxRedirects: 3, signal: ctx.signal });
      return { asset, res };
    } catch (err) {
      if (err instanceof SafeFetchError) return { asset, error: err };
      throw err;
    }
  });
}

function resourceFindings(results: Probed[]): Finding[] {
  const ok = results.filter((r): r is { asset: Asset; res: SafeFetchResponse } => 'res' in r);
  const out: Finding[] = [];

  const broken = ok.filter((r) => r.res.status >= 400);
  const unreachable = results.filter((r) => 'error' in r);
  if (broken.length) out.push(failed(R.broken, `${broken.length} of ${results.length} failed: ${broken.slice(0, 4).map((b) => `${b.asset.url} → ${b.res.status}`).join('; ')}`));
  else if (unreachable.length) out.push(warning(R.broken, `${unreachable.length} resource(s) could not be reached: ${unreachable.slice(0, 3).map((u) => u.asset.url).join('; ')}`));
  else out.push(passed(R.broken, `${results.length} resources checked.`));

  const good = ok.filter((r) => r.res.status < 400);

  // Caching: only same-origin assets, which the site owner controls.
  const own = good.filter((r) => r.asset.sameOrigin);
  if (own.length) {
    const weak = own.filter((r) => !longLived(header(r.res.headers, 'cache-control')));
    out.push(weak.length ? warning(R.caching, `${weak.length} of ${own.length} same-origin assets lack long-lived caching, e.g. ${weak.slice(0, 3).map((w) => `${w.asset.url} (${header(w.res.headers, 'cache-control') ?? 'no Cache-Control'})`).join('; ')}`) : passed(R.caching, `${own.length} same-origin assets checked.`));
  }

  // Compression of text assets
  const text = good.filter((r) => TEXT_TYPE.test(header(r.res.headers, 'content-type') ?? '') && Number(header(r.res.headers, 'content-length') ?? 0) > 1400);
  if (text.length) {
    const plain = text.filter((r) => !/gzip|br|deflate|zstd/i.test(header(r.res.headers, 'content-encoding') ?? ''));
    out.push(plain.length ? warning(R.compression, `${plain.length} of ${text.length} text resources are uncompressed, e.g. ${plain.slice(0, 3).map((p) => p.asset.url).join(', ')}`) : passed(R.compression, `${text.length} text resources are compressed.`));
  }

  // Sizes
  const sized = good.map((r) => ({ ...r, bytes: Number(header(r.res.headers, 'content-length') ?? NaN) })).filter((r) => Number.isFinite(r.bytes));
  const big = sized.filter((r) => r.bytes > (r.asset.kind === 'image' ? 500 * 1024 : 1024 * 1024));
  if (sized.length) out.push(big.length ? failed(R.size, `${big.length} large resource(s): ${big.slice(0, 3).map((b) => `${b.asset.url} (${kb(b.bytes)})`).join('; ')}`) : passed(R.size, `${sized.length} resources with known size are within limits.`));

  // Image formats
  const legacy = sized.filter((r) => r.asset.kind === 'image' && /image\/(png|jpe?g|gif)/i.test(header(r.res.headers, 'content-type') ?? '') && r.bytes > 100 * 1024);
  const images = sized.filter((r) => r.asset.kind === 'image');
  if (images.length) out.push(legacy.length ? warning(R.imageFormat, `${legacy.length} large legacy-format image(s): ${legacy.slice(0, 3).map((l) => `${l.asset.url} (${kb(l.bytes)})`).join('; ')}`) : passed(R.imageFormat));

  return out;
}

function longLived(cacheControl: string | undefined): boolean {
  if (!cacheControl) return false;
  if (/no-store|no-cache/i.test(cacheControl)) return false;
  if (/immutable/i.test(cacheControl)) return true;
  const m = /(?:s-maxage|max-age)=(\d+)/i.exec(cacheControl);
  return m ? Number(m[1]) >= 7 * 24 * 3600 : false;
}
