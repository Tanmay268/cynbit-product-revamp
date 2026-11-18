import { SafeFetchError } from '@wi/net-guard';
import { describe, expect, it } from 'vitest';
import { byRule, makeCtx } from '../test-helpers.js';
import { parseCookies, parseCsp, parseHstsMaxAge } from './parsers.js';
import { securityAnalyzer } from './security-analyzer.js';

const STRONG = {
  'content-type': 'text/html',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'self'; script-src 'self' https://cdn.example.com; frame-ancestors 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=()',
  server: 'nginx',
};
const httpRedirects = { 'HEAD http://example.com/': { url: 'https://example.com/', status: 200 } };

describe('securityAnalyzer: hardened site', () => {
  it('passes every check', async () => {
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: STRONG }, routes: httpRedirects }));
    expect(r.findings.filter((f) => f.status !== 'passed')).toEqual([]);
    expect(r.score).toBe(100);
  });

  it('always carries a scope note and never claims the site is secure', async () => {
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: STRONG }, routes: httpRedirects }));
    const note = byRule(r, 'security.scope-note');
    expect(note.severity).toBe('info');
    expect(note.description).toMatch(/does not mean the website is secure/);
    // Apart from the (negated) scope note itself, no finding may assert that the site is secure.
    const others = JSON.stringify(r.findings.filter((f) => f.ruleId !== 'security.scope-note'));
    expect(others).not.toMatch(/\bis secure\b|fully secure|100% secure|no vulnerabilit/i);
  });
});

describe('securityAnalyzer: missing headers are hardening gaps, not vulnerabilities', () => {
  it('flags absent headers and frames them as gaps', async () => {
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: { 'content-type': 'text/html' } }, routes: httpRedirects }));
    for (const id of ['security.hsts', 'security.csp', 'security.x-content-type-options', 'security.clickjacking', 'security.referrer-policy', 'security.permissions-policy']) {
      expect(byRule(r, id).status, id).toBe('failed');
    }
    for (const id of ['security.hsts', 'security.csp', 'security.x-content-type-options', 'security.clickjacking']) {
      expect(byRule(r, id).description, id).toMatch(/not a confirmed vulnerability/);
    }
    // No finding anywhere is labelled a "vulnerability" as a conclusion.
    expect(r.findings.every((f) => !/^vulnerab/i.test(f.title))).toBe(true);
  });

  it('accepts frame-ancestors as clickjacking protection without X-Frame-Options', async () => {
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: { ...STRONG } }, routes: httpRedirects }));
    expect(byRule(r, 'security.clickjacking').evidence).toMatch(/frame-ancestors/);
  });

  it('accepts X-Frame-Options alone', async () => {
    const { 'content-security-policy': _csp, ...rest } = STRONG;
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: { ...rest, 'x-frame-options': 'DENY' } }, routes: httpRedirects }));
    expect(byRule(r, 'security.clickjacking').status).toBe('passed');
    expect(byRule(r, 'security.csp').status).toBe('failed');
  });

  it('notes report-only CSP does not enforce', async () => {
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: { 'content-security-policy-report-only': "default-src 'self'" } }, routes: httpRedirects }));
    expect(byRule(r, 'security.csp').evidence).toMatch(/Report-Only/);
  });
});

describe('securityAnalyzer: policy quality', () => {
  it.each([
    ["default-src 'self' 'unsafe-inline'", /unsafe-inline/],
    ["script-src 'self' 'unsafe-eval'", /unsafe-eval/],
    ['script-src *', /wildcard/],
    ["img-src 'self'", /no script-src/],
  ])('warns on weak CSP %s', async (csp, expected) => {
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: { ...STRONG, 'content-security-policy': csp } }, routes: httpRedirects }));
    const f = byRule(r, 'security.csp-strength');
    expect(f.status).toBe('warning');
    expect(f.evidence).toMatch(expected);
  });

  it("does not penalise 'unsafe-inline' when a nonce is present", async () => {
    const csp = "script-src 'self' 'nonce-abc' 'unsafe-inline'";
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: { ...STRONG, 'content-security-policy': csp } }, routes: httpRedirects }));
    expect(byRule(r, 'security.csp-strength').status).toBe('passed');
  });

  it('warns on short HSTS max-age and weak referrer policy', async () => {
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: { ...STRONG, 'strict-transport-security': 'max-age=300', 'referrer-policy': 'unsafe-url' } }, routes: httpRedirects }));
    expect(byRule(r, 'security.hsts').status).toBe('warning');
    expect(byRule(r, 'security.referrer-policy').status).toBe('warning');
  });

  it('flags version disclosure', async () => {
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: { ...STRONG, server: 'Apache/2.4.41', 'x-powered-by': 'PHP/7.2.1' } }, routes: httpRedirects }));
    const f = byRule(r, 'security.information-disclosure');
    expect(f.status).toBe('failed');
    expect(f.evidence).toMatch(/Apache\/2\.4\.41/);
  });
});

describe('securityAnalyzer: transport', () => {
  it('flags plain HTTP as critical and skips HTTPS-only checks', async () => {
    const r = await securityAnalyzer.run(makeCtx({ url: 'http://example.com/', page: { url: 'http://example.com/', headers: STRONG } }));
    expect(byRule(r, 'security.https')).toMatchObject({ status: 'failed', severity: 'critical' });
    expect(r.findings.find((f) => f.ruleId === 'security.hsts')).toBeUndefined();
    expect(r.findings.find((f) => f.ruleId === 'security.certificate')).toBeUndefined();
  });

  it('flags HTTP that does not redirect to HTTPS', async () => {
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: STRONG }, routes: { 'HEAD http://example.com/': { url: 'http://example.com/', status: 200 } } }));
    expect(byRule(r, 'security.http-to-https-redirect').status).toBe('failed');
  });

  it('does not penalise sites that do not serve port 80 at all', async () => {
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: STRONG }, routes: { 'HEAD http://example.com/': new SafeFetchError('NETWORK', 'x') } }));
    expect(byRule(r, 'security.http-to-https-redirect').status).toBe('passed');
  });

  it('turns an invalid certificate into a critical FINDING (not an analyzer failure)', async () => {
    const r = await securityAnalyzer.run(makeCtx({ pageError: new SafeFetchError('TLS', "The website's HTTPS certificate has expired.") }));
    expect(r.status).toBe('completed');
    expect(byRule(r, 'security.certificate')).toMatchObject({ status: 'failed', severity: 'critical' });
    expect(byRule(r, 'security.certificate').evidence).toMatch(/expired/);
    expect(r.score).toBe(0);
  });

  it('propagates other fetch failures to the orchestrator', async () => {
    const err = new SafeFetchError('TIMEOUT', 'slow');
    await expect(securityAnalyzer.run(makeCtx({ pageError: err }))).rejects.toBe(err);
  });
});

describe('securityAnalyzer: cookies', () => {
  it('groups cookie problems by attribute and never leaks cookie values', async () => {
    const setCookie = ['sessionid=SUPERSECRETVALUE; Path=/', 'theme=dark; Secure; SameSite=Lax', 'csrf=zzz; Secure; HttpOnly; SameSite=Strict'];
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: { ...STRONG, 'set-cookie': setCookie } }, routes: httpRedirects }));
    expect(byRule(r, 'security.cookie-secure').evidence).toMatch(/sessionid/);
    const httpOnly = byRule(r, 'security.cookie-httponly');
    expect(httpOnly.status).toBe('failed'); // session-like cookie
    expect(httpOnly.evidence).toMatch(/sessionid/);
    expect(byRule(r, 'security.cookie-samesite').status).toBe('warning');
    expect(JSON.stringify(r)).not.toContain('SUPERSECRETVALUE');
  });

  it('is only a warning when a non-session cookie lacks HttpOnly', async () => {
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: { ...STRONG, 'set-cookie': ['theme=dark; Secure; SameSite=Lax'] } }, routes: httpRedirects }));
    expect(byRule(r, 'security.cookie-httponly')).toMatchObject({ status: 'warning', severity: 'low' });
  });

  it('emits no cookie findings when the response sets none', async () => {
    const r = await securityAnalyzer.run(makeCtx({ page: { headers: STRONG }, routes: httpRedirects }));
    expect(r.findings.some((f) => f.ruleId.startsWith('security.cookie'))).toBe(false);
  });
});

describe('parsers', () => {
  it('parseCsp lowercases and keeps the first occurrence of a directive', () => {
    const csp = parseCsp("Default-Src 'self'; script-src A; script-src B");
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('script-src')).toEqual(['a']);
  });
  it('parseHstsMaxAge', () => {
    expect(parseHstsMaxAge('max-age=31536000; preload')).toBe(31536000);
    expect(parseHstsMaxAge('includeSubDomains')).toBeNull();
  });
  it('parseCookies', () => {
    expect(parseCookies(['a=b; Secure; HttpOnly; SameSite=None'])).toEqual([{ name: 'a', secure: true, httpOnly: true, sameSite: 'none' }]);
  });
});
