import { Info } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import CountUp from './CountUp';
import Popover from './Popover';

export type StatDetail = { label: string; value: string; hint?: string };

type Props = {
  label: string;
  /** Numeric value used for the count animation, if any. */
  numeric?: number;
  format?: (value: number) => string;
  /** Exact display text. Shown at rest and read by assistive technology. */
  value: string;
  unit?: string;
  sub?: ReactNode;
  tone?: 'accent' | 'violet' | 'sky' | 'amber';
  details?: {
    title: string;
    description?: string;
    rows: readonly StatDetail[];
    note?: string;
  };
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
  details,
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
        {details && (
          <Popover
            trigger={
              <>
                Details <Info size={13} aria-hidden="true" />
              </>
            }
            triggerLabel={`${label} details`}
            title={details.title}
            className="stat-popover"
            triggerClassName="chip-button"
          >
            {details.description && (
              <p className="popover-text">{details.description}</p>
            )}
            <dl className="popover-rows">
              {details.rows.map((row) => (
                <div key={row.label}>
                  <dt>
                    {row.label}
                    {row.hint && <small>{row.hint}</small>}
                  </dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            {details.note && <p className="popover-note">{details.note}</p>}
          </Popover>
        )}
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
