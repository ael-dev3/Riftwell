import { useEffect, useRef } from 'react';
import type { Page } from './router';

export const SHORTCUTS: readonly { keys: string[]; label: string }[] = [
  { keys: ['g', 'b'], label: 'Go to Borrow' },
  { keys: ['g', 'e'], label: 'Go to Earn' },
  { keys: ['g', 'm'], label: 'Go to Marketplace' },
  { keys: ['g', 's'], label: 'Open the simulator' },
  { keys: ['g', 'f'], label: 'Open the FAQ' },
  { keys: ['/'], label: 'Search marketplace listings' },
  { keys: ['t'], label: 'Switch light or dark theme' },
  { keys: ['?'], label: 'Show keyboard shortcuts' },
];

const GOTO: Readonly<Record<string, Page>> = {
  b: 'borrow',
  e: 'earn',
  m: 'marketplace',
  s: 'simulator',
  f: 'faq',
};

type Handlers = {
  onNavigate: (page: Page) => void;
  onSearch: () => void;
  onTheme: () => void;
  onHelp: () => void;
};

function typing(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

/** Single-key shortcuts that never fire while typing or inside a dialog. */
export function useShortcuts(handlers: Handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    let pending = 0;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        typing(event.target) ||
        document.querySelector('[role="dialog"]')
      )
        return;
      const destination = GOTO[event.key];
      if (pending && Date.now() - pending < 1200 && destination) {
        event.preventDefault();
        pending = 0;
        ref.current.onNavigate(destination);
        return;
      }
      pending = 0;
      if (event.key === 'g') pending = Date.now();
      else if (event.key === '/') {
        event.preventDefault();
        ref.current.onSearch();
      } else if (event.key === '?') {
        event.preventDefault();
        ref.current.onHelp();
      } else if (event.key === 't') ref.current.onTheme();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
