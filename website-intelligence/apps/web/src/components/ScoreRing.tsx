import { scoreTone, TONE_LABEL, TONE_STROKE, TONE_TEXT } from '../utils/score';

interface Props {
  /** null = not available. NEVER pass 0 for "unknown": 0 means the page really scored zero. */
  score: number | null;
  size?: number;
  strokeWidth?: number;
  label?: string;
  className?: string;
}

/** Circular score gauge. Unavailable scores render a dashed, neutral ring with "N/A", not an empty/zero ring. */
export function ScoreRing({ score, size = 120, strokeWidth = 10, label, className = '' }: Props) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  const pct = score === null ? 0 : Math.min(100, Math.max(0, score));
  const aria = score === null ? `${label ? `${label}: ` : ''}score not available` : `${label ? `${label}: ` : ''}score ${score} out of 100, ${TONE_LABEL[tone].toLowerCase()}`;

  return (
    <div className={`relative inline-grid place-items-center ${className}`} style={{ width: size, height: size }} role="img" aria-label={aria}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e0e3e3" strokeWidth={strokeWidth} strokeDasharray={score === null ? '4 6' : undefined} />
        {score !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={TONE_STROKE[tone]}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct / 100)}
            style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(.2,.8,.2,1)' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center" aria-hidden>
        {score === null ? (
          <span className="text-sm font-bold text-outline" style={{ fontSize: size * 0.2 }}>N/A</span>
        ) : (
          <span className={`font-headline font-extrabold leading-none ${TONE_TEXT[tone]}`} style={{ fontSize: size * 0.32 }}>{score}</span>
        )}
      </div>
    </div>
  );
}
