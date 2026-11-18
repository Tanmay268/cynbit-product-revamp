import axe from 'axe-core';
import { chromium, type Browser, type Page } from 'playwright-core';
import { normalizeAxeResults } from '../analyzers/accessibility/axe-normalize.js';
import { AXE_OPTIONS, BrowserUnavailableError, PageLoadError, type AxeRunResult, type AxeRunner, type KeyboardProbe } from '../analyzers/accessibility/types.js';
import type { SafeFetch } from '@wi/net-guard';
import { handleBrowserRequest } from './browser-routing.js';

export interface BrowserConfig {
  /** Chromium's sandbox needs kernel features many containers lack; only disable inside a locked-down container. */
  noSandbox?: boolean;
  navigationTimeoutMs?: number;
  executablePath?: string;
  logger?: Pick<Console, 'warn'>;
  /**
   * ALL browser traffic is served through this fetch (see browser-routing.ts), so the browser obeys
   * exactly the same SSRF policy as every other request. Tests inject a relaxed instance.
   */
  fetch: SafeFetch;
}

const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/**
 * Production AxeRunner: real Chromium via Playwright, one shared browser per worker process and one
 * isolated, throwaway context per audit.
 *
 * Hardening (see docs/security.md):
 *  - every request is intercepted and served through safeFetch (browser-routing.ts): validated, DNS-pinned, size-capped
 *  - WebSockets, service workers, downloads and permission prompts are blocked
 *  - the context is destroyed after the audit, or immediately when the analyzer is aborted
 *  - launch failure => BrowserUnavailableError (category "unavailable"), never fake results
 */
export class PlaywrightAxeRunner implements AxeRunner {
  private browser: Promise<Browser> | null = null;

  constructor(private readonly config: BrowserConfig) {}

  private launch(): Promise<Browser> {
    this.browser ??= chromium
      .launch({
        headless: true,
        executablePath: this.config.executablePath,
        args: this.config.noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
      })
      .then((b) => {
        b.on('disconnected', () => (this.browser = null)); // relaunch on next audit if Chromium dies
        return b;
      })
      .catch((err: Error) => {
        this.browser = null;
        (this.config.logger ?? console).warn(`[worker] could not launch Chromium: ${err.message.split('\n')[0]}`);
        throw new BrowserUnavailableError('The accessibility testing browser is not installed or could not start on this worker.');
      });
    return this.browser;
  }

  async run(url: string, signal: AbortSignal): Promise<AxeRunResult> {
    const browser = await this.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'WebsiteIntelligenceBot/1.0 (+accessibility)',
      acceptDownloads: false,
      serviceWorkers: 'block',
      permissions: [],
      locale: 'en-US',
      ignoreHTTPSErrors: false,
    });
    const onAbort = () => void context.close().catch(() => undefined);
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      await context.route('**/*', (route) =>
        handleBrowserRequest(
          { url: () => route.request().url(), method: () => route.request().method(), headers: () => route.request().headers() },
          route,
          this.config.fetch,
        ),
      );
      await context.routeWebSocket(/.*/, (ws) => void ws.close());

      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: this.config.navigationTimeoutMs ?? 30_000 });
      } catch {
        throw new PageLoadError('The page could not be loaded in the browser.');
      }
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);

      // evaluate() runs via the DevTools protocol, so the page's CSP cannot block axe's injection.
      await page.evaluate(axe.source);
      const raw = await page.evaluate(`axe.run(document, ${JSON.stringify(AXE_OPTIONS)})`);
      const keyboard = await probeKeyboard(page);
      return normalizeAxeResults(raw as never, keyboard);
    } catch (err) {
      if (signal.aborted) throw err; // orchestrator already reports the timeout
      if (err instanceof PageLoadError) throw err;
      throw new PageLoadError('The page could not be analyzed in the browser.');
    } finally {
      signal.removeEventListener('abort', onAbort);
      await context.close().catch(() => undefined);
    }
  }

  async close() {
    const b = await this.browser?.catch(() => null);
    await b?.close().catch(() => undefined);
    this.browser = null;
  }
}

async function probeKeyboard(page: Page): Promise<KeyboardProbe> {
  const interactiveCount = await page.evaluate((sel) => document.querySelectorAll(sel).length, INTERACTIVE);
  const stops = new Set<string>();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const sig = await page.evaluate(() => {
      const e = document.activeElement;
      return e && e !== document.body ? `${e.tagName}|${e.getAttribute('href') ?? e.id ?? ''}|${stops_index(e)}` : '';
      function stops_index(el: Element) {
        return Array.prototype.indexOf.call(document.querySelectorAll('*'), el);
      }
    });
    if (sig) stops.add(sig);
  }
  const hasSkipLink = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="#"]')).slice(0, 3).some((a) => /skip/i.test(a.textContent ?? '')),
  );
  return { interactiveCount, tabStopsReached: stops.size, hasSkipLink };
}
