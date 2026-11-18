import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import { normalizeAxeResults } from './axe-normalize.js';
import { AXE_OPTIONS, type AxeRunResult, type AxeRunner } from './types.js';

/**
 * TEST-ONLY runner: runs the REAL axe-core engine against static HTML inside jsdom.
 * It exercises the same rules and normalisation as production, minus what needs layout
 * (colour contrast, visibility), which is disabled here and covered by the Playwright runner.
 */
export class JsdomAxeRunner implements AxeRunner {
  constructor(private readonly html: string) {}

  async run(): Promise<AxeRunResult> {
    const dom = new JSDOM(this.html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/' });
    const win = dom.window as unknown as { eval(code: string): void; axe: typeof axe; document: Document };
    try {
      win.eval(axe.source);
      const options = { ...JSON.parse(JSON.stringify(AXE_OPTIONS)), rules: { 'color-contrast': { enabled: false } } };
      const raw = await win.axe.run(win.document as never, options);
      const interactive = win.document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea').length;
      return normalizeAxeResults(raw as never, {
        interactiveCount: interactive,
        tabStopsReached: interactive > 0 ? 1 : 0,
        hasSkipLink: /skip/i.test(win.document.querySelector('a[href^="#"]')?.textContent ?? ''),
      });
    } finally {
      dom.window.close();
    }
  }
}
