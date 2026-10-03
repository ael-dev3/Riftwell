import type { LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { assetById } from '../data';
import { formatBalance, formatDate, formatMicros } from '../domain';
import { formatShares } from '../format';
import type { LendingActivity } from '../lending';
import { activityLabel } from '../preview/actions';

export function PageHead({
  title,
  lede,
  actions,
  titleId,
  compact = false,
}: {
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
  compact?: boolean;
}) {
  // Workspaces open straight on their controls; the heading stays for
  // assistive technology.
  if (compact)
    return (
      <h1 className="sr-only" id={titleId}>
        {title}
      </h1>
    );
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title" id={titleId}>
          {title}
        </h1>
        {lede && <p className="page-lede">{lede}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  compact = false,
  inline = false,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  /** A single row, for empty sections above the content people act on. */
  inline?: boolean;
}) {
  return (
    <div
      className={`empty${compact ? ' compact' : ''}${inline ? ' inline' : ''}`}
    >
      <span className="empty-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

function activityAmount(entry: LendingActivity): string {
  if (entry.kind === 'increase-lock') {
    const asset = entry.collateralId ? assetById(entry.collateralId) : null;
    return `+${formatBalance(Number(entry.lockUnits), asset?.underlyingSymbol ?? 'tokens')}`;
  }
  if (entry.kind === 'epoch') {
    const repaid =
      BigInt(entry.rewardRepaidMicros) + BigInt(entry.relayerRepaidMicros);
    return repaid > 0n ? `${formatMicros(repaid)} repaid` : 'No repayment';
  }
  if (BigInt(entry.amountMicros) > 0n) return formatMicros(entry.amountMicros);
  return '—';
}

function activityDetail(entry: LendingActivity): string {
  const asset = entry.collateralId ? assetById(entry.collateralId) : undefined;
  if (entry.kind === 'borrow')
    return `Fee ${formatMicros(entry.feeMicros)} · net ${formatMicros(BigInt(entry.amountMicros) - BigInt(entry.feeMicros))}`;
  if (entry.kind === 'purchase')
    return `${asset?.name ?? 'Sample position'} · seller fee ${formatMicros(entry.feeMicros)}`;
  if (entry.kind === 'epoch')
    return `Surplus ${formatMicros(entry.rewardSurplusMicros)}${
      BigInt(entry.relayerRewardMicros) > 0n
        ? ` · relayer ${formatMicros(entry.relayerRewardMicros)}${
            BigInt(entry.relayerRepaidMicros) > 0n
              ? ` (${formatMicros(entry.relayerRepaidMicros)} to debt)`
              : ''
          }`
        : ''
    } · lender revenue ${formatMicros(entry.poolYieldMicros)}`;
  if (entry.kind === 'supply' || entry.kind === 'withdraw')
    return `${formatShares(entry.sharesRaw)} shares`;
  if (entry.kind === 'merge') {
    const source = entry.mergedId ? assetById(entry.mergedId) : undefined;
    return `${source?.name ?? 'Wallet position'} into ${asset?.name ?? 'collateral'}`;
  }
  return asset?.name ?? 'Preview action';
}

type Filter = { id: string; label: string; kinds: readonly string[] };

export function ActivityTable({
  entries,
  filters,
  caption,
  empty,
}: {
  entries: readonly LendingActivity[];
  filters: readonly Filter[];
  caption: string;
  empty: ReactNode;
}) {
  const [filter, setFilter] = useState(filters[0]?.id ?? 'all');
  const kinds = filters.find((item) => item.id === filter)?.kinds ?? [];
  const rows = entries
    .filter((entry) => kinds.includes(entry.kind))
    .slice()
    .reverse();
  return (
    <div className="activity">
      <div className="chip-row" role="group" aria-label="Filter activity">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            className="chip-toggle"
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table className="data-table activity-table">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Details</th>
                <th scope="col">Date</th>
                <th scope="col" className="numeric">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id}>
                  <td data-label="Action">
                    <span className={`activity-kind kind-${entry.kind}`}>
                      <span aria-hidden="true" className="activity-dot" />
                      {activityLabel[entry.kind]}
                    </span>
                  </td>
                  <td data-label="Details" className="text-muted">
                    {activityDetail(entry)}
                  </td>
                  <td data-label="Date" className="text-muted">
                    <time dateTime={entry.createdAt}>
                      {formatDate(entry.createdAt)}
                    </time>
                  </td>
                  <td data-label="Amount" className="numeric">
                    {activityAmount(entry)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        empty
      )}
    </div>
  );
}
