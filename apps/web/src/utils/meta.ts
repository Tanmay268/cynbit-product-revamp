import { Accessibility, BadgeCheck, Gauge, Search, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { AuditCategoryId, CategoryStatus, FindingStatus, Severity } from '@wi/shared';

export interface CategoryMeta {
  label: string;
  icon: LucideIcon;
  /** One-liner for marketing/summary use. */
  blurb: string;
  /** What is actually measured, shown on the landing page. */
  measures: string[];
}

export const CATEGORY_META: Record<AuditCategoryId, CategoryMeta> = {
  performance: {
    label: 'Performance',
    icon: Gauge,
    blurb: 'How fast the page loads and responds on a mobile connection.',
    measures: ['Largest Contentful Paint', 'Layout shift & blocking time', 'Biggest speed-up opportunities'],
  },
  seo: {
    label: 'SEO',
    icon: Search,
    blurb: 'Whether search engines can find, understand and index your pages.',
    measures: ['Titles, descriptions & headings', 'Canonical, robots.txt & sitemap', 'Broken internal links'],
  },
  accessibility: {
    label: 'Accessibility',
    icon: Accessibility,
    blurb: 'Whether people using assistive technology can use the site.',
    measures: ['WCAG checks with axe-core', 'Labels, alt text & contrast', 'Keyboard reachability'],
  },
  security: {
    label: 'Security',
    icon: ShieldCheck,
    blurb: 'HTTPS and browser-level hardening visible from outside. Findings are hardening gaps, not confirmed vulnerabilities.',
    measures: ['HTTPS & certificate', 'Security headers & CSP', 'Cookie attributes'],
  },
  'best-practices': {
    label: 'Best Practices',
    icon: BadgeCheck,
    blurb: 'Modern, efficient, error-free ways of serving a site.',
    measures: ['Mixed content & broken resources', 'Caching & compression', 'Redirects & image formats'],
  },
};

export const SEVERITY_META: Record<Severity, { label: string; rank: number; classes: string }> = {
  critical: { label: 'Critical', rank: 0, classes: 'bg-poor text-white' },
  high: { label: 'High', rank: 1, classes: 'bg-sev-high-container text-sev-high ring-1 ring-sev-high/30' },
  medium: { label: 'Medium', rank: 2, classes: 'bg-fair-container text-fair ring-1 ring-fair/30' },
  low: { label: 'Low', rank: 3, classes: 'bg-secondary-fixed text-secondary ring-1 ring-secondary/30' },
  info: { label: 'Info', rank: 4, classes: 'bg-surface-container text-on-surface-variant ring-1 ring-outline-variant' },
};

export const FINDING_STATUS_META: Record<FindingStatus, { label: string; classes: string }> = {
  failed: { label: 'Failed', classes: 'bg-poor-container text-on-error-container' },
  warning: { label: 'Warning', classes: 'bg-fair-container text-fair' },
  passed: { label: 'Passed', classes: 'bg-good-container text-good' },
};

export const CATEGORY_STATUS_LABEL: Record<CategoryStatus, string> = {
  pending: 'Waiting',
  running: 'Running',
  completed: 'Done',
  unavailable: 'Unavailable',
  failed: 'Failed',
};
