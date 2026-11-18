export type ScoreTone = 'good' | 'fair' | 'poor' | 'none';

/** 90+ good, 50-89 needs work, below 50 poor, null = not available (never a score). */
export function scoreTone(score: number | null | undefined): ScoreTone {
  if (score === null || score === undefined) return 'none';
  if (score >= 90) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

export const TONE_TEXT: Record<ScoreTone, string> = {
  good: 'text-good',
  fair: 'text-fair',
  poor: 'text-poor',
  none: 'text-outline',
};
export const TONE_BG: Record<ScoreTone, string> = {
  good: 'bg-good',
  fair: 'bg-fair',
  poor: 'bg-poor',
  none: 'bg-outline-variant',
};
export const TONE_STROKE: Record<ScoreTone, string> = {
  good: '#17784b',
  fair: '#8a5a00',
  poor: '#ba1a1a',
  none: '#bdc9ca',
};
export const TONE_LABEL: Record<ScoreTone, string> = {
  good: 'Good',
  fair: 'Needs work',
  poor: 'Poor',
  none: 'Not available',
};
