import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { withViewTransition } from './motion';

export type Page = 'borrow' | 'earn' | 'marketplace' | 'simulator' | 'faq';
export type Route = { page: Page; item: string | null };

export const PAGES: readonly Page[] = [
  'borrow',
  'earn',
  'marketplace',
  'simulator',
  'faq',
];
export const PRIMARY_PAGES: readonly Page[] = ['borrow', 'earn', 'marketplace'];
export const PAGE_LABELS: Readonly<Record<Page, string>> = {
  borrow: 'Borrow',
  earn: 'Earn',
  marketplace: 'Marketplace',
  simulator: 'Simulator',
  faq: 'FAQ',
};
const LEGACY: Readonly<Record<string, Page>> = { lending: 'borrow' };
const ITEM = /^[a-z0-9-]{1,40}$/;

/** Parse "#page" or "#page/item". Unknown routes return null. */
export function parseHash(hash: string): Route | null {
  const [name = '', item, extra] = hash.replace(/^#/, '').split('/');
  if (extra !== undefined) return null;
  const page = (PAGES as readonly string[]).includes(name)
    ? (name as Page)
    : LEGACY[name];
  if (!page) return null;
  if (item === undefined) return { page, item: null };
  return page === 'marketplace' && ITEM.test(item) ? { page, item } : null;
}

export const routeHash = (route: Route) =>
  `#${route.page}${route.item ? `/${route.item}` : ''}`;

function currentRoute(fallback: Page): Route {
  return parseHash(window.location.hash) ?? { page: fallback, item: null };
}

/**
 * Hash routing that works on static hosting. Legacy and unknown hashes are
 * replaced (not pushed) so the back button never lands on a dead route.
 */
export function useHashRoute(fallback: Page = 'borrow') {
  const [route, setRoute] = useState<Route>(() => currentRoute(fallback));

  useEffect(() => {
    const canonical = routeHash(currentRoute(fallback));
    if (window.location.hash !== canonical)
      window.history.replaceState(null, '', canonical);
    const sync = () => {
      const next = parseHash(window.location.hash);
      if (!next) {
        window.history.replaceState(null, '', routeHash(route));
        return;
      }
      if (window.location.hash !== routeHash(next))
        window.history.replaceState(null, '', routeHash(next));
      // popstate and hashchange can both fire for one traversal.
      if (routeHash(next) === routeHash(route)) return;
      withViewTransition(() => flushSync(() => setRoute(next)));
    };
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
    // The fallback is fixed for the lifetime of the application.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const navigate = useCallback(
    (next: Route, mode: 'push' | 'replace' = 'push') => {
      const hash = routeHash(next);
      if (window.location.hash !== hash) {
        if (mode === 'push') window.history.pushState(null, '', hash);
        else window.history.replaceState(null, '', hash);
      }
      withViewTransition(() => flushSync(() => setRoute(next)));
    },
    [],
  );

  return { route, navigate };
}
