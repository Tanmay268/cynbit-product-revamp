import { createAccessibilityAnalyzer } from './accessibility/accessibility-analyzer.js';
import type { AxeRunner } from './accessibility/types.js';
import { bestPracticesAnalyzer } from './best-practices/best-practices-analyzer.js';
import { performanceAnalyzer } from './performance/performance-analyzer.js';
import { securityAnalyzer } from './security/security-analyzer.js';
import { seoAnalyzer } from './seo/seo-analyzer.js';
import type { Analyzer } from './types.js';

/**
 * The single place analyzers are registered. Adding a category means writing an Analyzer and
 * adding it here (plus the category to @wi/shared); the orchestrator needs no changes.
 */
export function createAnalyzers(deps: { axeRunner: AxeRunner }): Analyzer[] {
  return [
    performanceAnalyzer,
    seoAnalyzer,
    createAccessibilityAnalyzer(deps.axeRunner),
    securityAnalyzer,
    bestPracticesAnalyzer,
  ];
}
