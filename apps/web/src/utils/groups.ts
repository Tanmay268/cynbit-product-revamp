import type { AuditListItem } from '@wi/shared';

export interface SiteGroup {
  normalizedUrl: string;
  /** Newest first. */
  audits: AuditListItem[];
  latestScore: number | null;
  /** latest - previous, using the two most recent audits that have an overall score; null if fewer than two. */
  delta: number | null;
  /** Oldest -> newest overall scores for the trend chart. */
  trend: { id: string; date: string; score: number }[];
}

const scored = (a: AuditListItem) => (a.status === 'completed' || a.status === 'partial') && a.overallScore !== null;

/** Groups audits by site and works out the score change between the latest two scored runs. */
export function groupBySite(items: readonly AuditListItem[]): SiteGroup[] {
  const map = new Map<string, AuditListItem[]>();
  for (const a of items) map.set(a.normalizedUrl, [...(map.get(a.normalizedUrl) ?? []), a]);

  return [...map.entries()]
    .map(([normalizedUrl, list]) => {
      const audits = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const withScore = audits.filter(scored);
      const [latest, previous] = withScore;
      return {
        normalizedUrl,
        audits,
        latestScore: latest?.overallScore ?? null,
        delta: latest && previous ? (latest.overallScore as number) - (previous.overallScore as number) : null,
        trend: [...withScore].reverse().map((a) => ({ id: a.id, date: a.createdAt, score: a.overallScore as number })),
      };
    })
    .sort((a, b) => (b.audits[0]!.createdAt).localeCompare(a.audits[0]!.createdAt)); // most recently audited site first
}

export const canCompare = (a: AuditListItem) => a.status === 'completed' || a.status === 'partial';
