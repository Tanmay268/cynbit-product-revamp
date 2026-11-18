import * as cheerio from 'cheerio';
import { SafeFetchError } from '@wi/net-guard';
import type { Finding } from '@wi/shared';
import type { Analyzer, AnalyzerContext } from '../types.js';
import { buildResult, check, failed, header, mapLimit, passed, truncate, warning, type Rule } from '../common.js';
import { parseRobots } from './robots.js';

const R = {
  status: {
    ruleId: 'seo.http-status',
    title: 'Page returns a successful HTTP status',
    description: 'Search engines only index pages that respond with a 2xx status.',
    severity: 'critical',
    recommendation: 'Make the page return 200 OK. Error pages are dropped from search results.',
    impact: 'Pages that return errors are not indexed and cannot rank.',
  },
  title: {
    ruleId: 'seo.title',
    title: 'Page has a descriptive <title>',
    description: 'The title is the main clickable headline in search results. Aim for roughly 10-60 characters.',
    severity: 'high',
    recommendation: 'Add a unique, descriptive <title> of about 10-60 characters that includes the primary topic of the page.',
    impact: 'Missing or poor titles reduce rankings and click-through rate.',
  },
  description: {
    ruleId: 'seo.meta-description',
    title: 'Page has a meta description',
    description: 'The meta description is often used as the snippet under the title in search results. Aim for roughly 50-160 characters.',
    severity: 'medium',
    recommendation: 'Add <meta name="description"> of about 50-160 characters that summarises the page and invites a click.',
    impact: 'Search engines will generate a snippet themselves, which is often less compelling.',
  },
  h1: {
    ruleId: 'seo.h1',
    title: 'Page has exactly one <h1>',
    description: 'A single H1 states the main topic of the page for users and search engines.',
    severity: 'medium',
    recommendation: 'Use one <h1> that describes the page. Use <h2>-<h6> for sub-sections.',
    impact: 'A missing or duplicated H1 weakens topical clarity.',
  },
  headings: {
    ruleId: 'seo.heading-hierarchy',
    title: 'Headings follow a logical hierarchy',
    description: 'Heading levels should not skip (for example <h2> directly followed by <h4>).',
    severity: 'low',
    recommendation: 'Nest headings in order (h1 > h2 > h3) without skipping levels.',
    impact: 'A broken outline makes the page harder to scan and to parse.',
  },
  canonical: {
    ruleId: 'seo.canonical',
    title: 'Page declares a canonical URL',
    description: 'A canonical link tells search engines which URL is the preferred version when content is reachable at several addresses.',
    severity: 'medium',
    recommendation: 'Add a single <link rel="canonical" href="https://..."> pointing to the preferred absolute URL.',
    impact: 'Duplicate URLs can split ranking signals.',
  },
  indexable: {
    ruleId: 'seo.indexability',
    title: 'Page is allowed to be indexed',
    description: 'A noindex robots meta tag or X-Robots-Tag header removes the page from search results.',
    severity: 'critical',
    recommendation: 'Remove the noindex directive if this page should appear in search results.',
    impact: 'A noindex page will not appear in search at all.',
  },
  og: {
    ruleId: 'seo.open-graph',
    title: 'Open Graph metadata is present',
    description: 'og:title, og:description and og:image control how the page looks when shared on social platforms and messengers.',
    severity: 'low',
    recommendation: 'Add og:title, og:description, og:image (and og:url) meta tags.',
    impact: 'Shared links render as plain, unattractive previews.',
  },
  alt: {
    ruleId: 'seo.image-alt',
    title: 'Images have alt attributes',
    description: 'Every <img> needs an alt attribute (an empty alt="" is correct for purely decorative images).',
    severity: 'medium',
    recommendation: 'Add concise, meaningful alt text to informative images and alt="" to decorative ones.',
    impact: 'Missing alt text hurts image search and accessibility.',
  },
  internalLinks: {
    ruleId: 'seo.internal-links',
    title: 'Page links to other pages on the site',
    description: 'Internal links let crawlers and users discover related content.',
    severity: 'low',
    recommendation: 'Link to relevant internal pages with descriptive anchor text.',
    impact: 'Pages without internal links are harder to discover and pass no authority onward.',
  },
  anchorText: {
    ruleId: 'seo.anchor-text',
    title: 'Links use descriptive text',
    description: 'Link text such as "click here" or empty links give search engines and screen-reader users no context.',
    severity: 'low',
    recommendation: 'Replace generic or empty link text with a short description of the destination.',
    impact: 'Weaker relevance signals and a worse experience for assistive technology.',
  },
  brokenLinks: {
    ruleId: 'seo.broken-links',
    title: 'Sampled internal links are not broken',
    description: 'Checks up to 10 internal links on the page for 4xx/5xx responses.',
    severity: 'high',
    recommendation: 'Fix or remove the broken links, or redirect them to a relevant live page.',
    impact: 'Broken links waste crawl budget and frustrate users.',
  },
  robots: {
    ruleId: 'seo.robots-txt',
    title: 'robots.txt is available and does not block the whole site',
    description: 'robots.txt tells crawlers which paths they may fetch.',
    severity: 'medium',
    recommendation: 'Serve a robots.txt at /robots.txt. Never use "Disallow: /" for all user agents on a live site.',
    impact: 'Blocking everything prevents the site from being crawled.',
  },
  robotsBlocksAll: {
    ruleId: 'seo.robots-blocks-all',
    title: 'robots.txt does not block all crawlers',
    description: 'A "User-agent: *" group containing "Disallow: /" blocks the entire site from compliant crawlers.',
    severity: 'critical',
    recommendation: 'Remove "Disallow: /" from the wildcard group (or scope it to a specific path).',
    impact: 'The site cannot be crawled, so it will not rank.',
  },
  sitemap: {
    ruleId: 'seo.sitemap',
    title: 'XML sitemap is available',
    description: 'A sitemap lists the URLs you want indexed and helps crawlers find them.',
    severity: 'medium',
    recommendation: 'Publish /sitemap.xml (or reference one in robots.txt with a "Sitemap:" line).',
    impact: 'New or deep pages may be discovered slowly.',
  },
  lang: {
    ruleId: 'seo.html-lang',
    title: '<html> declares a language',
    description: 'The lang attribute helps search engines serve the page to the right audience.',
    severity: 'low',
    recommendation: 'Add lang="en" (or the correct language code) to the <html> element.',
    impact: 'Language targeting and accessibility tooling rely on it.',
  },
  viewport: {
    ruleId: 'seo.viewport',
    title: 'Page has a mobile viewport meta tag',
    description: 'Search engines index the mobile version of pages first; a viewport tag is the baseline for mobile-friendly layouts.',
    severity: 'medium',
    recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    impact: 'Pages that are not mobile-friendly rank lower on mobile.',
  },
} satisfies Record<string, Rule>;

const GENERIC_ANCHOR = /^(click here|here|read more|more|learn more|link|this|click)$/i;

export const seoAnalyzer: Analyzer = {
  category: 'seo',
  async run(ctx) {
    const started = Date.now();
    const page = await ctx.page();
    const findings: Finding[] = [];

    const ok = page.status >= 200 && page.status < 300;
    findings.push(check(R.status, ok, `HTTP ${page.status}`));
    if (!ok) return buildResult('seo', findings, started); // nothing else is meaningful on an error page

    const base = new URL(page.url);
    const $ = cheerio.load(page.body.toString('utf8'));

    // Title
    const title = $('head title').first().text().trim() || $('title').first().text().trim();
    if (!title) findings.push(failed(R.title, 'No <title> element found.'));
    else if (title.length < 10 || title.length > 60) findings.push(warning(R.title, `"${truncate(title, 120)}" is ${title.length} characters (recommended 10-60).`));
    else findings.push(passed(R.title, `"${title}" (${title.length} characters)`));

    // Meta description
    const desc = ($('meta[name="description" i]').attr('content') ?? '').trim();
    if (!desc) findings.push(failed(R.description, 'No meta description found.'));
    else if (desc.length < 50 || desc.length > 160) findings.push(warning(R.description, `${desc.length} characters (recommended 50-160): "${truncate(desc, 160)}"`));
    else findings.push(passed(R.description, `${desc.length} characters`));

    // H1 + hierarchy
    const h1s = $('h1');
    if (h1s.length === 0) findings.push(failed(R.h1, 'No <h1> found.'));
    else if (h1s.length > 1) findings.push(warning(R.h1, `${h1s.length} <h1> elements found: ${h1s.toArray().slice(0, 3).map((e) => `"${truncate($(e).text().trim(), 60)}"`).join(', ')}`));
    else findings.push(passed(R.h1, `"${truncate(h1s.first().text().trim(), 100)}"`));

    const skips: string[] = [];
    let prev = 0;
    $('h1,h2,h3,h4,h5,h6').each((_, el) => {
      const level = Number(el.tagName.slice(1));
      if (prev !== 0 && level > prev + 1) skips.push(`h${prev} -> h${level}`);
      prev = level;
    });
    findings.push(check(R.headings, skips.length === 0, skips.length ? `Skipped levels: ${skips.slice(0, 5).join(', ')}` : null));

    // Canonical
    const canonicals = $('link[rel="canonical" i]').toArray().map((e) => $(e).attr('href') ?? '');
    if (canonicals.length === 0) findings.push(failed(R.canonical, 'No canonical link found.'));
    else if (canonicals.length > 1) findings.push(warning(R.canonical, `${canonicals.length} canonical links found; search engines ignore conflicting canonicals.`));
    else {
      let resolved: URL | null = null;
      try {
        resolved = new URL(canonicals[0] as string, base);
      } catch {
        /* handled below */
      }
      if (!resolved) findings.push(warning(R.canonical, `Canonical "${canonicals[0]}" is not a valid URL.`));
      else if (resolved.hostname !== base.hostname) findings.push(warning(R.canonical, `Canonical points to another host: ${resolved.href}`));
      else findings.push(passed(R.canonical, resolved.href));
    }

    // Indexability
    const robotsMeta = ($('meta[name="robots" i]').attr('content') ?? '').toLowerCase();
    const xRobots = (header(page.headers, 'x-robots-tag') ?? '').toLowerCase();
    const noindex = /noindex|none/.test(robotsMeta) || /noindex|none/.test(xRobots);
    findings.push(check(R.indexable, !noindex, noindex ? `robots meta: "${robotsMeta}" X-Robots-Tag: "${xRobots}"` : 'No noindex directive.'));

    // Open Graph
    const og = ['og:title', 'og:description', 'og:image'].filter((p) => !($(`meta[property="${p}"]`).attr('content') ?? '').trim());
    if (og.length === 3) findings.push(failed(R.og, 'No Open Graph tags found.'));
    else if (og.length > 0) findings.push(warning(R.og, `Missing: ${og.join(', ')}`));
    else findings.push(passed(R.og));

    // Image alt
    const imgs = $('img');
    const noAlt = imgs.toArray().filter((e) => $(e).attr('alt') === undefined);
    if (imgs.length === 0) findings.push(passed(R.alt, 'No images on the page.'));
    else findings.push(check(R.alt, noAlt.length === 0, noAlt.length ? `${noAlt.length} of ${imgs.length} images have no alt attribute, e.g. ${noAlt.slice(0, 3).map((e) => $(e).attr('src') ?? '(no src)').join(', ')}` : `${imgs.length} images checked`));

    // Links
    const anchors = $('a[href]').toArray();
    const internal = new Map<string, string>();
    const poorText: string[] = [];
    for (const a of anchors) {
      const href = ($(a).attr('href') ?? '').trim();
      if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      let u: URL;
      try {
        u = new URL(href, base);
      } catch {
        continue;
      }
      const text = ($(a).text().trim() || $(a).attr('aria-label') || $(a).find('img').attr('alt') || '').trim();
      if (!text || GENERIC_ANCHOR.test(text)) poorText.push(href);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname === base.hostname) {
        u.hash = '';
        internal.set(u.href, text);
      }
    }
    findings.push(check(R.internalLinks, internal.size > 0, `${internal.size} unique internal link(s)`));
    findings.push(check(R.anchorText, poorText.length === 0, poorText.length ? `${poorText.length} link(s) with empty or generic text, e.g. ${poorText.slice(0, 3).join(', ')}` : null));

    // Language + viewport
    const lang = ($('html').attr('lang') ?? '').trim();
    findings.push(check(R.lang, lang !== '', lang ? `lang="${lang}"` : 'No lang attribute on <html>.'));
    findings.push(check(R.viewport, $('meta[name="viewport" i]').length > 0));

    // Network checks: broken links, robots.txt, sitemap
    findings.push(...(await networkChecks(ctx, base, [...internal.keys()].filter((u) => u !== base.href))));

    return buildResult('seo', findings, started);
  },
};

async function networkChecks(ctx: AnalyzerContext, base: URL, links: string[]): Promise<Finding[]> {
  const out: Finding[] = [];
  const get = async (url: string, method: 'GET' | 'HEAD' = 'GET', maxBytes = 200_000) => {
    try {
      return await ctx.fetch(url, { method, timeoutMs: 8_000, maxBytes, maxRedirects: 3, signal: ctx.signal });
    } catch (err) {
      if (err instanceof SafeFetchError) return err;
      throw err;
    }
  };

  // Broken links (sample)
  const sample = links.slice(0, 10);
  if (sample.length > 0) {
    const results = await mapLimit(sample, 4, async (url) => {
      let res = await get(url, 'HEAD');
      if (!(res instanceof SafeFetchError) && (res.status === 405 || res.status === 501)) res = await get(url, 'GET', 1);
      return { url, res };
    });
    const broken = results.filter((r) => !(r.res instanceof SafeFetchError) && r.res.status >= 400);
    const unreachable = results.filter((r) => r.res instanceof SafeFetchError);
    if (broken.length > 0) {
      out.push(failed(R.brokenLinks, `${broken.length} of ${sample.length} sampled links are broken: ${broken.slice(0, 5).map((b) => `${b.url} -> ${(b.res as { status: number }).status}`).join('; ')}`));
    } else if (unreachable.length > 0) {
      out.push(warning(R.brokenLinks, `${unreachable.length} of ${sample.length} sampled links could not be reached: ${unreachable.slice(0, 3).map((b) => b.url).join('; ')}`));
    } else {
      out.push(passed(R.brokenLinks, `${sample.length} internal links checked, none broken.`));
    }
  }

  // robots.txt
  const robotsRes = await get(new URL('/robots.txt', base.origin).href);
  let sitemapUrls: string[] = [];
  if (robotsRes instanceof SafeFetchError || robotsRes.status !== 200 || /html/i.test(header(robotsRes.headers, 'content-type') ?? '')) {
    out.push(warning(R.robots, robotsRes instanceof SafeFetchError ? robotsRes.message : `GET /robots.txt returned HTTP ${robotsRes.status}`));
  } else {
    const parsed = parseRobots(robotsRes.body.toString('utf8'));
    sitemapUrls = parsed.sitemaps;
    out.push(passed(R.robots, 'robots.txt found.'));
    out.push(check(R.robotsBlocksAll, !parsed.blocksAll, parsed.blocksAll ? 'User-agent: * has Disallow: /' : null));
  }

  // Sitemap
  const candidates = sitemapUrls.length > 0 ? sitemapUrls.slice(0, 2) : [new URL('/sitemap.xml', base.origin).href];
  let sitemapOk = false;
  let lastEvidence = '';
  for (const url of candidates) {
    const res = await get(url, 'GET', 100_000);
    if (res instanceof SafeFetchError) {
      lastEvidence = res.message;
      continue;
    }
    const head = res.body.subarray(0, 600).toString('utf8');
    if (res.status === 200 && /<(urlset|sitemapindex)[\s>]/i.test(head)) {
      sitemapOk = true;
      lastEvidence = url;
      break;
    }
    lastEvidence = `${url} returned HTTP ${res.status}${res.status === 200 ? ' but is not a valid sitemap' : ''}`;
  }
  out.push(check(R.sitemap, sitemapOk, lastEvidence));
  return out;
}
