# Audit analyzers

Each analyzer implements `Analyzer` ([`apps/worker/src/analyzers/types.ts`](../apps/worker/src/analyzers/types.ts)) and returns the
same `AnalyzerResult`. They run **independently and concurrently**; one failing never fails the audit.
Registered in [`registry.ts`](../apps/worker/src/analyzers/registry.ts), the only file to touch when adding a category.

| Category | Source | What it checks |
|---|---|---|
| **Performance** | Google PageSpeed Insights (mobile) | FCP, LCP, CLS, INP (real-user data), Speed Index, TBT, top Lighthouse opportunities. Score = Lighthouse's own, unchanged |
| **SEO** | Cheerio on the fetched HTML + extra requests | status, title, meta description, H1, heading order, canonical, noindex (meta + header), Open Graph, image alt, internal links, anchor text, broken links (10-link sample), robots.txt (+ block-all detection), sitemap, `lang`, viewport |
| **Accessibility** | Chromium (Playwright) + axe-core | WCAG 2.0/2.1/2.2 A+AA and best-practice rules: names, alt text, labels, contrast, heading order, landmarks, ARIA. Plus keyboard reachability and skip-link probe. Reports rule ids and DOM evidence |
| **Security** | Response headers/cookies/TLS | HTTPS, certificate validity, HTTP→HTTPS redirect, HSTS, CSP (+ weakness), nosniff, framing protection, Referrer-Policy, Permissions-Policy, cookie Secure/HttpOnly/SameSite, version disclosure |
| **Best Practices** | HTML + sampled assets + Lighthouse | mixed content, broken resources, static caching, compression, resource size, image formats/dimensions, redirect chain, doctype, charset, plus selected Lighthouse audits that do not duplicate the above |

## Shared inputs (fetched once per audit)

`ctx.page()` (the main HTML) and `ctx.pagespeed()` are memoised by the orchestrator, so SEO, Security and Best Practices share one
page fetch, and Performance and Best Practices share one PageSpeed call. Best Practices only adopts Lighthouse audits our own checks do
not already cover (no `is-on-https`, `doctype`, `charset`, CSP/HSTS…), so no finding appears twice.

## Honest results

- Missing `PAGESPEED_API_KEY`, an invalid key, a quota hit, an outage or a timeout => Performance is **unavailable** (null score, reason shown). Nothing is estimated.
- Chromium not installed/launchable => Accessibility is **unavailable**.
- Site unreachable => the categories that need it are **failed** with a user-safe reason; an **invalid TLS certificate** is not a failure but a critical Security *finding*.
- The Security analyzer calls missing headers *hardening gaps*, never confirmed vulnerabilities, and always ends with a scope note that a clean result does not mean a site is secure.

## Known limitations

- Broken-link and asset checks are **sampled** (10 links / 12 assets) to bound time and load on the audited site.
- Cookies are only observable on the single page response; cookies set by scripts or other pages are not seen.
- `landmark-one-main` / `page-has-heading-one` need real layout; they are authoritative only in the Chromium run.
- axe-core finds roughly a third of WCAG issues automatically. A clean automated result is not a conformance claim.
- The audit browser serves GET/HEAD only and does not carry cookies, so pages that require a login or POST to render are audited in their logged-out state.

## Running the real-browser tests

They are opt-in because they need a browser binary:

```bash
# Windows example using an installed Chrome
WI_CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" npm test -w @wi/worker
# or install Playwright's Chromium and point at it
npx playwright-core install chromium
```
