import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';
export const THEME_STORAGE_KEY = 'riftwell.theme';
const COLORS: Readonly<Record<Theme, string>> = {
  dark: '#080b0a',
  light: '#f2f5f1',
};
const listeners = new Set<() => void>();

export function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme, persist = true) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', COLORS[theme]);
  if (persist)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The theme still applies for this visit when storage is unavailable.
    }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => 'dark');
  const toggle = useCallback(
    () => applyTheme(readTheme() === 'dark' ? 'light' : 'dark'),
    [],
  );
  return { theme, toggle };
}
