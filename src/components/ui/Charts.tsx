import { useId, useMemo, useState, type CSSProperties } from 'react';

type Series = { label: string; values: readonly number[]; tone?: string };

type AreaProps = {
  series: readonly Series[];
  labels?: readonly string[];
  ariaLabel: string;
  format: (value: number) => string;
  height?: number;
  markerIndex?: number;
};

const WIDTH = 640;

/** A responsive area/line chart with keyboard- and pointer-readable points. */
export function AreaChart({
  series,
  labels = [],
  ariaLabel,
  format,
  height = 220,
  markerIndex,
}: AreaProps) {
  const gradient = useId();
  const [hover, setHover] = useState<number | null>(null);
  const count = Math.max(...series.map((item) => item.values.length), 0);
  const max = Math.max(1, ...series.flatMap((item) => item.values));
  const pad = { top: 14, right: 12, bottom: 26, left: 12 };
  const innerW = WIDTH - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (index: number) =>
    pad.left + (count <= 1 ? innerW / 2 : (innerW * index) / (count - 1));
  const y = (value: number) => pad.top + innerH - (innerH * value) / max;
  const paths = useMemo(
    () =>
      series.map((item) => {
        const points = item.values.map(
          (value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`,
        );
        const line = `M${points.join('L')}`;
        const area = `${line}L${x(item.values.length - 1).toFixed(2)},${pad.top + innerH}L${x(0).toFixed(2)},${pad.top + innerH}Z`;
        return { line, area, label: item.label, tone: item.tone };
      }),
    // Geometry depends only on the plotted values and height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, height, max, count],
  );
  if (!count) return null;
  const active = hover ?? markerIndex ?? null;
  const tickIndexes = [0, Math.floor((count - 1) / 2), count - 1].filter(
    (value, index, all) => all.indexOf(value) === index,
  );

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / box.width;
          const position = (ratio * WIDTH - pad.left) / innerW;
          setHover(
            Math.min(
              count - 1,
              Math.max(0, Math.round(position * (count - 1))),
            ),
          );
        }}
      >
        <defs>
          {series.map((item, index) => (
            <linearGradient
              key={item.label}
              id={`${gradient}-${index}`}
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            >
              <stop offset="0%" className={`stop-top ${item.tone ?? ''}`} />
              <stop
                offset="100%"
                className={`stop-bottom ${item.tone ?? ''}`}
              />
            </linearGradient>
          ))}
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            className="chart-grid"
            x1={pad.left}
            x2={WIDTH - pad.right}
            y1={pad.top + innerH * ratio}
            y2={pad.top + innerH * ratio}
          />
        ))}
        {paths.map((path, index) => (
          <g key={path.label} className={`chart-series ${path.tone ?? ''}`}>
            <path
              className="chart-area"
              d={path.area}
              fill={`url(#${gradient}-${index})`}
            />
            <path className="chart-line" d={path.line} pathLength={1} />
          </g>
        ))}
        {active !== null && (
          <line
            className="chart-cursor"
            x1={x(active)}
            x2={x(active)}
            y1={pad.top}
            y2={pad.top + innerH}
          />
        )}
      </svg>
      <div className="chart-axis" aria-hidden="true">
        {tickIndexes.map((index) => (
          <span key={index}>{labels[index] ?? ''}</span>
        ))}
      </div>
      {active !== null && (
        <figcaption className="chart-readout" aria-hidden="true">
          {labels[active] && <span>{labels[active]}</span>}
          {series.map((item) => (
            <span key={item.label} className={item.tone}>
              <i /> {item.label}: {format(item.values[active] ?? 0)}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

type Bar = { label: string; value: number; display: string };

export function BarChart({
  bars,
  ariaLabel,
}: {
  bars: readonly Bar[];
  ariaLabel: string;
}) {
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <figure className="bar-chart" role="img" aria-label={ariaLabel}>
      {bars.map((bar, index) => (
        <div className="bar" key={bar.label} aria-hidden="true">
          <span className="bar-value">{bar.display}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={
                {
                  transform: `scaleY(${bar.value / max})`,
                  '--i': index,
                } as CSSProperties
              }
            />
          </span>
          <span className="bar-label">{bar.label}</span>
        </div>
      ))}
    </figure>
  );
}

export function Sparkline({
  values,
  label,
}: {
  values: readonly number[];
  label: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = Math.max(1e-9, max - min);
  const points = values
    .map(
      (value, index) =>
        `${((100 * index) / (values.length - 1)).toFixed(2)},${(28 - (24 * (value - min)) / span).toFixed(2)}`,
    )
    .join(' ');
  return (
    <svg
      className="sparkline"
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polyline points={points} pathLength={1} />
    </svg>
  );
}
