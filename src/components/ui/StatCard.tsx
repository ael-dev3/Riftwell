import type { CSSProperties, ReactNode } from 'react';
import CountUp from './CountUp';

type Props = {
  label: string;
  /** Numeric value used for the count animation, if any. */
  numeric?: number | undefined;
  format?: (value: number) => string;
  /** Exact display text. Shown at rest and read by assistive technology. */
  value: string;
  unit?: string | undefined;
  sub?: ReactNode;
  tone?: 'accent' | 'violet' | 'sky' | 'amber';
  index?: number;
};

export default function StatCard({
  label,
  numeric,
  format,
  value,
  unit,
  sub,
  tone = 'accent',
  index = 0,
}: Props) {
  return (
    <article
      className={`stat-card tone-${tone}`}
      style={{ '--i': index } as CSSProperties}
    >
      <div className="stat-top">
        <h3 className="stat-label">
          <span className="stat-dot" aria-hidden="true" />
          {label}
        </h3>
      </div>
      <p className="stat-value">
        {numeric !== undefined && format ? (
          <CountUp value={numeric} format={format} exact={value} fromZero />
        ) : (
          value
        )}
        {unit && <span className="stat-unit">{unit}</span>}
      </p>
      {sub && <p className="stat-sub">{sub}</p>}
    </article>
  );
}
