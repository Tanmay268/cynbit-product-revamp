import type { Finding, Severity } from '@wi/shared';
import type { Analyzer } from '../types.js';
import { buildResult, failedResult, outcome, truncate, unavailable, type Rule } from '../common.js';
import { BrowserUnavailableError, PageLoadError, type AxeImpact, type AxeRule, type AxeRunner } from './types.js';

const SEVERITY: Record<Exclude<AxeImpact, null>, Severity> = { critical: 'critical', serious: 'high', moderate: 'medium', minor: 'low' };
const MAX_INCOMPLETE = 10;

const KEYBOARD: Rule = {
  ruleId: 'accessibility.keyboard-focusable',
  title: 'Interactive elements can be reached with the keyboard',
  description: 'Pressing Tab should move focus through links, buttons and form controls.',
  severity: 'high',
  recommendation: 'Use native interactive elements (<a href>, <button>, <input>), avoid tabindex="-1" on controls, and make sure custom widgets are focusable.',
  impact: 'Keyboard and screen-reader users cannot operate controls they cannot focus.',
};
const SKIP_LINK: Rule = {
  ruleId: 'accessibility.skip-link',
  title: 'Page offers a "skip to content" link',
  description: 'Pages with many interactive elements should let keyboard users bypass repeated navigation.',
  severity: 'low',
  recommendation: 'Add a visually-hidden-until-focused link as the first focusable element, e.g. <a href="#main">Skip to main content</a>.',
  impact: 'Keyboard users must tab through the whole navigation on every page (WCAG 2.4.1).',
};

/** "wcag143" -> "1.4.3" */
const wcagCriteria = (tags: string[]) =>
  tags
    .map((t) => /^wcag(\d)(\d)(\d+)$/.exec(t))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `${m[1]}.${m[2]}.${m[3]}`);

function violationFinding(v: AxeRule): Finding {
  const criteria = wcagCriteria(v.tags);
  const evidence = `${v.nodeCount} element(s) affected:\n` +
    v.nodes.slice(0, 3).map((n) => `• ${n.target.join(' ')}: ${n.html}${n.failureSummary ? `\n  ${truncate(n.failureSummary.split('\n').slice(0, 2).join(' '), 200)}` : ''}`).join('\n');
  return outcome(
    {
      ruleId: `accessibility.${v.id}`,
      title: v.help,
      description: v.description,
      severity: v.impact ? SEVERITY[v.impact] : 'medium',
      recommendation: `${v.nodes[0]?.failureSummary ? `${truncate(v.nodes[0].failureSummary.replace(/\s+/g, ' '), 240)} ` : ''}${v.helpUrl ? `See ${v.helpUrl}` : ''}`.trim() || v.help,
      impact: `axe impact: ${v.impact ?? 'unknown'}${criteria.length ? `; WCAG ${criteria.join(', ')}` : ''}.`,
    },
    'failed',
    evidence,
  );
}

/**
 * Accessibility analysis with axe-core in a real browser. The runner is injected so tests can use
 * jsdom or canned results, while production uses Playwright (see services/browser.ts).
 * Heading structure, landmarks, ARIA, labels, alt text and (in a real browser) colour contrast come from axe's
 * WCAG A/AA and best-practice rule sets; keyboard reachability is probed separately.
 */
export function createAccessibilityAnalyzer(runner: AxeRunner): Analyzer {
  return {
    category: 'accessibility',
    async run(ctx) {
      const started = Date.now();
      let res;
      try {
        res = await runner.run(ctx.url, ctx.signal);
      } catch (err) {
        if (err instanceof BrowserUnavailableError) return unavailable('accessibility', err.message, started);
        if (err instanceof PageLoadError) return failedResult('accessibility', err.message, started);
        throw err;
      }

      const findings: Finding[] = [];
      findings.push(...res.violations.map(violationFinding));

      // "Needs review": axe could not decide. Reported as low-severity warnings, never as failures.
      for (const i of res.incomplete.slice(0, MAX_INCOMPLETE)) {
        findings.push(
          outcome(
            {
              ruleId: `accessibility.review.${i.id}`,
              title: `Manual review needed: ${i.help}`,
              description: i.description,
              severity: 'low',
              recommendation: `Check these elements manually. ${i.helpUrl}`.trim(),
              impact: 'Automated testing could not confirm whether this passes.',
            },
            'warning',
            `${i.nodeCount} element(s), e.g. ${i.nodes[0]?.target.join(' ') ?? 'n/a'}`,
          ),
        );
      }

      // Passing rules are real checks that count toward the score.
      const failedIds = new Set(res.violations.map((v) => v.id));
      for (const p of res.passes.filter((p) => !failedIds.has(p.id))) {
        findings.push(
          outcome({ ruleId: `accessibility.${p.id}`, title: p.help, description: p.help, severity: 'medium', recommendation: '' }, 'passed'),
        );
      }

      // Keyboard
      const k = res.keyboard;
      if (k.interactiveCount > 0) {
        findings.push(
          outcome(KEYBOARD, k.tabStopsReached > 0 ? 'passed' : 'failed', `${k.interactiveCount} interactive element(s); ${k.tabStopsReached} reached with Tab.`),
        );
      }
      if (k.interactiveCount > 10) {
        findings.push(outcome(SKIP_LINK, k.hasSkipLink ? 'passed' : 'warning', k.hasSkipLink ? 'Skip link found.' : 'No skip link found.'));
      }

      return buildResult('accessibility', findings, started);
    },
  };
}
