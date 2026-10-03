import { useId } from 'react';

type Props = { size?: number };

export default function PortalMark({ size = 37 }: Props) {
  const gradientId = `portal-${useId()}`;

  return (
    <svg
      className="portal-mark"
      width={size}
      height={size}
      viewBox="0 0 80 80"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--violet)" />
          <stop offset="0.5" stopColor="var(--text)" />
          <stop offset="1" stopColor="var(--violet)" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <rect width="80" height="80" rx="12" fill="var(--surface-2)" />
      <ellipse
        cx="40"
        cy="40"
        rx="17"
        ry="26"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="4"
        transform="rotate(32 40 40)"
      />
      <ellipse
        cx="40"
        cy="40"
        rx="8"
        ry="19"
        fill="none"
        stroke="var(--violet)"
        strokeOpacity="0.8"
        strokeWidth="2"
        transform="rotate(32 40 40)"
      />
      <circle cx="62" cy="18" r="3" fill="var(--violet)" />
    </svg>
  );
}
