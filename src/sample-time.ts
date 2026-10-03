// Sample positions and sales were written as of 2 October 2026 (UTC). Their
// dates move forward by whole days with the calendar, so sample locks, sales
// and charts stay current instead of ageing. Fictional sample data only.
const AUTHORED_MS = Date.parse('2026-10-02T00:00:00Z');
const DAY_MS = 86_400_000;

/** Whole days since the sample data was written, in milliseconds. */
export function sampleShiftMs(now: number): number {
  return Math.max(0, Math.floor((now - AUTHORED_MS) / DAY_MS)) * DAY_MS;
}

/** One shift for the whole page load, so every sample date agrees. */
export const SAMPLE_SHIFT_MS = sampleShiftMs(Date.now());

/** An authored sample date (YYYY-MM-DD), moved forward to the current day. */
export function sampleDate(authored: string, shift = SAMPLE_SHIFT_MS): string {
  return new Date(Date.parse(`${authored}T00:00:00Z`) + shift)
    .toISOString()
    .slice(0, 10);
}
