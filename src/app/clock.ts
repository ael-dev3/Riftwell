import { useSyncExternalStore } from 'react';

// One shared timer for every countdown, aligned to the next whole minute and
// paused while the document is hidden.
const listeners = new Set<() => void>();
let now = Date.now();
let timer: number | undefined;

function schedule() {
  window.clearTimeout(timer);
  if (!listeners.size || document.hidden) return;
  timer = window.setTimeout(
    () => {
      now = Date.now();
      listeners.forEach((listener) => listener());
      schedule();
    },
    60_000 - (Date.now() % 60_000) + 50,
  );
}

function onVisibility() {
  if (!document.hidden) {
    now = Date.now();
    listeners.forEach((listener) => listener());
  }
  schedule();
}

function subscribe(listener: () => void) {
  if (!listeners.size)
    document.addEventListener('visibilitychange', onVisibility);
  listeners.add(listener);
  now = Date.now();
  schedule();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}

/** The current time, refreshed once per minute. */
export function useMinuteClock(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
}
