type MeterProps = {
  /** Percentage from 0 to 100. Values outside the range are clamped visually. */
  value: number;
  label: string;
  tone?: 'accent' | 'warning' | 'danger';
  size?: 'thin' | 'regular';
};

export function Meter({
  value,
  label,
  tone = 'accent',
  size = 'regular',
}: MeterProps) {
  const bounded = Math.min(100, Math.max(0, value));
  return (
    <div
      className={`meter ${size} ${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(bounded * 100) / 100}
    >
      <span
        className="meter-fill"
        style={{ transform: `scaleX(${bounded / 100})` }}
      />
    </div>
  );
}

type RingProps = {
  value: number;
  label: string;
  caption: string;
  size?: number;
};

/** A circular progress indicator with its percentage in the centre. */
export function Ring({ value, label, caption, size = 132 }: RingProps) {
  const bounded = Math.min(100, Math.max(0, value));
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className="ring"
      role="img"
      aria-label={`${label}: ${bounded.toFixed(1)}%`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 128 128" aria-hidden="true">
        <circle className="ring-track" cx="64" cy="64" r={radius} />
        <circle
          className={`ring-value${bounded >= 85 ? ' high' : ''}`}
          cx="64"
          cy="64"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - bounded / 100)}
        />
      </svg>
      <span className="ring-center" aria-hidden="true">
        <strong>{bounded.toFixed(bounded > 0 && bounded < 10 ? 1 : 0)}%</strong>
        <small>{caption}</small>
      </span>
    </div>
  );
}
