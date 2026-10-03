// KittenSwap's Voter reports its period as whole weeks since the Unix epoch
// (period 2961 began on Thursday 1 October 2026, 00:00 UTC). Reward periods
// therefore flip every Thursday at 00:00 UTC. This is clock arithmetic only.
export const EPOCH_SECONDS = 604_800;
const EPOCH_MS = EPOCH_SECONDS * 1000;

export type EpochClock = {
  period: number;
  startMs: number;
  endMs: number;
  remainingMs: number;
  progress: number;
};

export function epochAt(nowMs: number): EpochClock {
  const period = Math.floor(nowMs / EPOCH_MS);
  const startMs = period * EPOCH_MS;
  const endMs = startMs + EPOCH_MS;
  return {
    period,
    startMs,
    endMs,
    remainingMs: endMs - nowMs,
    progress: (nowMs - startMs) / EPOCH_MS,
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Countdown at minute resolution, e.g. "5d 05h 04m". */
export function formatCountdown(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return `${days}d ${pad(hours)}h ${pad(minutes % 60)}m`;
}

/** Spoken form for assistive technology, e.g. "5 days, 5 hours and 4 minutes". */
export function describeCountdown(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const parts = [
    [Math.floor(minutes / 1440), 'day'],
    [Math.floor((minutes % 1440) / 60), 'hour'],
    [minutes % 60, 'minute'],
  ] as const;
  const words = parts
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value} ${unit}${value === 1 ? '' : 's'}`);
  if (!words.length) return 'less than a minute';
  return words.length === 1
    ? (words[0] ?? 'less than a minute')
    : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

export function formatFlip(ms: number): string {
  return `${new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(ms))}, 00:00 UTC`;
}

/** The UTC start of an epoch a given number of flips after `period`. */
export const epochStartMs = (period: number) => period * EPOCH_MS;
