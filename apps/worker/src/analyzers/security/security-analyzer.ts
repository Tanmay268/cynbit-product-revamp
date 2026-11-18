import { SafeFetchError } from '@wi/net-guard';
import type { Finding } from '@wi/shared';
import type { Analyzer, AnalyzerContext } from '../types.js';
import { buildResult, check, failed, header, outcome, passed, warning, type Rule } from '../common.js';
import { parseCookies, parseCsp, parseHstsMaxAge } from './parsers.js';

/**
 * Header-level analysis only. Every rule below describes a *hardening gap*; none of them is a
 * confirmed vulnerability, and passing all of them does not prove a site is secure.
 */
const GAP = ' This is a missing hardening control, not a confirmed vulnerability.';

const R = {
  https: {
    ruleId: 'security.https',
    title: 'Site is served over HTTPS',
    description: 'Traffic over plain HTTP can be read and modified by anyone on the network path.',
    severity: 'critical',
    recommendation: 'Serve the site over HTTPS with a valid certificate and redirect all HTTP traffic to it.',
    impact: 'Visitors’ traffic and any credentials they send are exposed in transit.',
  },
  certificate: {
    ruleId: 'security.certificate',
    title: 'HTTPS certificate is valid',
    description: 'The site’s TLS certificate must be valid, trusted and match the domain.',
    severity: 'critical',
    recommendation: 'Install a valid certificate from a trusted authority that covers this domain, including the full chain.',
    impact: 'Browsers show a security warning and most visitors will leave; the connection cannot be trusted.',
  },
  httpRedirect: {
    ruleId: 'security.http-to-https-redirect',
    title: 'HTTP requests are redirected to HTTPS',
    description: 'Visitors who type http:// should be sent to the secure version automatically.',
    severity: 'high',
    recommendation: 'Add a permanent (301/308) redirect from http:// to https:// for every URL.',
    impact: 'Users on the HTTP version are exposed to interception and downgrade attacks.',
  },
  hsts: {
    ruleId: 'security.hsts',
    title: 'Strict-Transport-Security (HSTS) is enabled',
    description: 'HSTS tells browsers to only use HTTPS for this site. A max-age of at least 6 months (15552000 s) is recommended.' + GAP,
    severity: 'medium',
    recommendation: 'Send "Strict-Transport-Security: max-age=31536000; includeSubDomains" on HTTPS responses.',
    impact: 'Without HSTS, first-visit and downgrade attacks on HTTPS are easier.',
  },
  csp: {
    ruleId: 'security.csp',
    title: 'Content-Security-Policy is defined',
    description: 'CSP restricts where scripts, styles and other resources may load from, limiting the damage of injection bugs.' + GAP,
    severity: 'medium',
    recommendation: 'Define a Content-Security-Policy. Start in report-only mode, then enforce a policy that avoids unsafe-inline/unsafe-eval.',
    impact: 'A strong CSP is one of the most effective mitigations against cross-site scripting.',
  },
  cspStrength: {
    ruleId: 'security.csp-strength',
    title: 'Content-Security-Policy avoids unsafe sources',
    description: 'Directives such as unsafe-inline, unsafe-eval or a bare wildcard in script-src/default-src largely cancel the protection of a CSP.',
    severity: 'medium',
    recommendation: 'Remove unsafe-inline/unsafe-eval and wildcards; use nonces or hashes for inline scripts and list trusted origins explicitly.',
    impact: 'A permissive CSP gives a false sense of protection against script injection.',
  },
  nosniff: {
    ruleId: 'security.x-content-type-options',
    title: 'X-Content-Type-Options: nosniff is set',
    description: 'Stops browsers from guessing (“sniffing”) content types, which can turn uploads into executable scripts.' + GAP,
    severity: 'low',
    recommendation: 'Send "X-Content-Type-Options: nosniff".',
    impact: 'Reduces MIME-confusion attacks.',
  },
  framing: {
    ruleId: 'security.clickjacking',
    title: 'Framing is restricted (clickjacking protection)',
    description: 'X-Frame-Options or a CSP frame-ancestors directive stops other sites embedding this page in a frame.' + GAP,
    severity: 'medium',
    recommendation: 'Send "Content-Security-Policy: frame-ancestors \'self\'" (and optionally "X-Frame-Options: SAMEORIGIN").',
    impact: 'Attackers can overlay the page in a hidden frame to trick users into clicking.',
  },
  referrer: {
    ruleId: 'security.referrer-policy',
    title: 'Referrer-Policy is set to a privacy-preserving value',
    description: 'Controls how much URL information is leaked to other sites when users follow links.' + GAP,
    severity: 'low',
    recommendation: 'Send "Referrer-Policy: strict-origin-when-cross-origin" (or stricter).',
    impact: 'Full URLs, which can include tokens or personal data, may leak to third parties.',
  },
  permissions: {
    ruleId: 'security.permissions-policy',
    title: 'Permissions-Policy is defined',
    description: 'Restricts powerful browser features (camera, microphone, geolocation…) for this page and embedded frames.' + GAP,
    severity: 'low',
    recommendation: 'Send a Permissions-Policy that disables features you do not use, e.g. "camera=(), microphone=(), geolocation=()".',
    impact: 'Embedded third-party content could otherwise request sensitive features.',
  },
  cookieSecure: {
    ruleId: 'security.cookie-secure',
    title: 'Cookies set over HTTPS use the Secure attribute',
    description: 'Without Secure, a cookie may be sent over unencrypted connections. Only cookies set on this response are observable.',
    severity: 'medium',
    recommendation: 'Add the Secure attribute to every cookie.',
    impact: 'Cookies (potentially session identifiers) can be intercepted on insecure connections.',
  },
  cookieHttpOnly: {
    ruleId: 'security.cookie-httponly',
    title: 'Cookies use the HttpOnly attribute',
    description: 'HttpOnly hides a cookie from JavaScript. This matters most for session and authentication cookies.',
    severity: 'medium',
    recommendation: 'Add HttpOnly to session/authentication cookies and any cookie scripts do not need to read.',
    impact: 'A cross-site scripting bug could steal cookies that are not HttpOnly.',
  },
  cookieSameSite: {
    ruleId: 'security.cookie-samesite',
    title: 'Cookies declare a SameSite policy',
    description: 'SameSite limits when cookies are sent on cross-site requests, reducing CSRF risk.',
    severity: 'low',
    recommendation: 'Set SameSite=Lax (or Strict) unless the cookie must be sent cross-site, in which case use SameSite=None; Secure.',
    impact: 'Cookies without SameSite rely on browser defaults to resist cross-site request forgery.',
  },
  disclosure: {
    ruleId: 'security.information-disclosure',
    title: 'Response headers do not reveal software versions',
    description: 'Server and X-Powered-By headers that include version numbers help attackers pick known exploits.',
    severity: 'low',
    recommendation: 'Remove X-Powered-By and strip version numbers from the Server header.',
    impact: 'Reduces the effort needed to fingerprint outdated software.',
  },
  scope: {
    ruleId: 'security.scope-note',
    title: 'Scope of this analysis',
    description:
      'This check inspects HTTPS configuration, response headers and cookies on the page response only. It does not test for application vulnerabilities, so a clean result does not mean the website is secure.',
    severity: 'info',
    recommendation: 'Complement this with dependency scanning, a penetration test and secure development practices.',
  },
} satisfies Record<string, Rule>;

const SESSION_COOKIE = /sess|sid|auth|token|jwt|login|account/i;

export const securityAnalyzer: Analyzer = {
  category: 'security',
  async run(ctx) {
    const started = Date.now();

    let page;
    try {
      page = await ctx.page();
    } catch (err) {
      // An invalid certificate is a *finding*, not an analyzer failure.
      if (err instanceof SafeFetchError && err.code === 'TLS') {
        return buildResult('security', [failed(R.certificate, err.message), passed(R.scope)], started);
      }
      throw err;
    }

    const findings: Finding[] = [];
    const h = page.headers;
    const final = new URL(page.url);
    const isHttps = final.protocol === 'https:';

    findings.push(check(R.https, isHttps, isHttps ? 'Final URL uses HTTPS.' : `Final URL is ${page.url}`));
    if (isHttps) findings.push(passed(R.certificate, 'The certificate was accepted by the TLS handshake.'));

    if (isHttps) findings.push(await httpRedirectCheck(ctx, final));

    // HSTS (only meaningful over HTTPS)
    if (isHttps) {
      const hsts = header(h, 'strict-transport-security');
      const maxAge = hsts ? parseHstsMaxAge(hsts) : null;
      if (!hsts) findings.push(failed(R.hsts, 'Header not present.'));
      else if (maxAge === null || maxAge < 15_552_000) findings.push(warning(R.hsts, `"${hsts}" (max-age should be at least 15552000).`));
      else findings.push(passed(R.hsts, hsts));
    }

    // CSP
    const cspRaw = header(h, 'content-security-policy');
    if (!cspRaw) {
      const reportOnly = header(h, 'content-security-policy-report-only');
      findings.push(failed(R.csp, reportOnly ? 'Only Content-Security-Policy-Report-Only is set; it reports but does not enforce.' : 'Header not present.'));
    } else {
      findings.push(passed(R.csp, cspRaw.length > 300 ? `${cspRaw.slice(0, 300)}…` : cspRaw));
      const csp = parseCsp(cspRaw);
      const script = csp.get('script-src') ?? csp.get('default-src') ?? [];
      const weak: string[] = [];
      if (script.includes("'unsafe-inline'") && !script.some((s) => s.startsWith("'nonce-") || s.startsWith("'sha"))) weak.push("'unsafe-inline' in script-src");
      if (script.includes("'unsafe-eval'")) weak.push("'unsafe-eval' in script-src");
      if (script.includes('*') || script.includes('http:') || script.includes('https:')) weak.push('wildcard/scheme-only source in script-src');
      if (!csp.has('script-src') && !csp.has('default-src')) weak.push('no script-src or default-src');
      findings.push(weak.length ? warning(R.cspStrength, weak.join('; ')) : passed(R.cspStrength));
    }

    // nosniff
    const xcto = header(h, 'x-content-type-options');
    findings.push(check(R.nosniff, xcto?.toLowerCase().includes('nosniff') === true, xcto ? `"${xcto}"` : 'Header not present.'));

    // Clickjacking: XFO or CSP frame-ancestors
    const xfo = header(h, 'x-frame-options');
    const frameAncestors = cspRaw ? parseCsp(cspRaw).get('frame-ancestors') : undefined;
    const framed = Boolean(frameAncestors) || /^(deny|sameorigin)/i.test(xfo ?? '');
    findings.push(check(R.framing, framed, framed ? (frameAncestors ? `frame-ancestors ${frameAncestors.join(' ')}` : `X-Frame-Options: ${xfo}`) : 'Neither X-Frame-Options nor CSP frame-ancestors is set.'));

    // Referrer-Policy
    const rp = header(h, 'referrer-policy');
    if (!rp) findings.push(failed(R.referrer, 'Header not present.'));
    else if (/unsafe-url|no-referrer-when-downgrade/i.test(rp)) findings.push(warning(R.referrer, `"${rp}" leaks full URLs cross-origin.`));
    else findings.push(passed(R.referrer, rp));

    findings.push(check(R.permissions, Boolean(header(h, 'permissions-policy') ?? header(h, 'feature-policy')), 'Header not present.'));

    // Cookies observable on this response
    findings.push(...cookieFindings(h['set-cookie'], isHttps));

    // Information disclosure
    const server = header(h, 'server') ?? '';
    const powered = header(h, 'x-powered-by') ?? '';
    const leaks = [powered && `X-Powered-By: ${powered}`, /\d+\.\d+/.test(server) && `Server: ${server}`].filter(Boolean);
    findings.push(check(R.disclosure, leaks.length === 0, leaks.join('; ')));

    findings.push(passed(R.scope));
    return buildResult('security', findings, started);
  },
};

async function httpRedirectCheck(ctx: AnalyzerContext, final: URL): Promise<Finding> {
  const httpUrl = `http://${final.hostname}/`;
  try {
    const res = await ctx.fetch(httpUrl, { method: 'HEAD', timeoutMs: 6_000, maxRedirects: 5, signal: ctx.signal });
    if (res.url.startsWith('https://')) return passed(R.httpRedirect, `${httpUrl} -> ${res.url}`);
    return failed(R.httpRedirect, `${httpUrl} responded with HTTP ${res.status} and stayed on plain HTTP.`);
  } catch {
    // Port 80 closed or unreachable: nothing is served over HTTP, which is acceptable.
    return passed(R.httpRedirect, 'Plain HTTP is not served.');
  }
}

function cookieFindings(raw: string | string[] | undefined, isHttps: boolean): Finding[] {
  const cookies = parseCookies(([] as string[]).concat(raw ?? []));
  if (cookies.length === 0) return [];
  const names = (list: { name: string }[]) => list.map((c) => c.name).slice(0, 8).join(', ');

  const out: Finding[] = [];
  if (isHttps) {
    const bad = cookies.filter((c) => !c.secure);
    out.push(bad.length ? failed(R.cookieSecure, `Missing Secure: ${names(bad)}`) : passed(R.cookieSecure, `${cookies.length} cookie(s) checked.`));
  }
  const noHttpOnly = cookies.filter((c) => !c.httpOnly);
  const sessionLike = noHttpOnly.filter((c) => SESSION_COOKIE.test(c.name));
  if (noHttpOnly.length === 0) out.push(passed(R.cookieHttpOnly));
  else if (sessionLike.length) out.push(failed(R.cookieHttpOnly, `Session-like cookies without HttpOnly: ${names(sessionLike)}`));
  else out.push(outcome({ ...R.cookieHttpOnly, severity: 'low' }, 'warning', `Without HttpOnly: ${names(noHttpOnly)}`));

  const noSameSite = cookies.filter((c) => !c.sameSite);
  out.push(noSameSite.length ? warning(R.cookieSameSite, `No SameSite attribute: ${names(noSameSite)}`) : passed(R.cookieSameSite));
  return out;
}
