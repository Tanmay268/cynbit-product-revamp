export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical' | null;

export interface AxeNode {
  /** Trimmed outer HTML of the offending element. */
  html: string;
  /** CSS selector path(s) to the element. */
  target: string[];
  failureSummary?: string;
}

export interface AxeRule {
  id: string;
  impact: AxeImpact;
  help: string;
  description: string;
  helpUrl: string;
  tags: string[];
  /** Total affected elements (nodes below is capped for payload size). */
  nodeCount: number;
  nodes: AxeNode[];
}

export interface KeyboardProbe {
  /** Interactive elements in the DOM (links, buttons, form controls, tabindex>=0). */
  interactiveCount: number;
  /** Distinct elements that received focus within the first 6 Tab presses. */
  tabStopsReached: number;
  hasSkipLink: boolean;
}

export interface AxeRunResult {
  violations: AxeRule[];
  /** Rules axe could not decide automatically (need human review). */
  incomplete: AxeRule[];
  passes: { id: string; help: string }[];
  keyboard: KeyboardProbe;
}

/** The browser is not installed/launchable on this worker: the category is "unavailable", not failed. */
export class BrowserUnavailableError extends Error {}
/** The target page could not be loaded in the browser (blocked, timed out, crashed). */
export class PageLoadError extends Error {}

export interface AxeRunner {
  run(url: string, signal: AbortSignal): Promise<AxeRunResult>;
}

/** WCAG 2.x A/AA + best-practice rules (heading order, landmarks, regions, tabindex…). */
export const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  resultTypes: ['violations', 'incomplete', 'passes'],
} as const;
