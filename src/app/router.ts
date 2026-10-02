import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { withViewTransition } from './motion';

export type Page =
  | 'borrow'
  | 'earn'
  | 'marketplace'
  | 'simulator'
  | 'faq'
  | 'stats'
  | 'brand'
  | 'privacy'
  | 'not-found';
export type Route = { page: Page; item: string | null };

/** Pages reachable by name. "not-found" is only ever a parse result. */
export const PAGES: readonly Page[] = [
  'borrow',
  'earn',
  'marketplace',
  'simulator',
  'faq',
  'stats',
  'brand',
  'privacy',
];
export const PRIMARY_PAGES: readonly Page[] = ['borrow', 'earn', 'marketplace'];
export const PAGE_LABELS: Readonly<Record<Page, string>> = {
  borrow: 'Borrow',
  earn: 'Earn',
  marketplace: 'Marketplace',
  simulator: 'Simulator',
  faq: 'FAQ',
  stats: 'Statistics',
  brand: 'Brand kit',
  privacy: 'Privacy',
  'not-found': 'Not found',
};
const LEGACY: Readonly<Record<string, Page>> = { lending: 'borrow' };
const ITEM = /^[a-z0-9-]{1,40}$/;

/**
 * Parse "#page" or "#page/item". An empty hash opens the fallback page; an
 * unknown or malformed hash becomes a not-found route that keeps its text.
 */
export function parseHash(hash: string, fallback: Page = 'borrow'): Route {
  const path = hash.replace(/^#/, '');
  if (!path) return { page: fallback, item: null };
  const [name = '', item, extra] = path.split('/');
  const page = (PAGES as readonly string[]).includes(name)
    ? (name as Page)
    : LEGACY[name];
  if (page && extra === undefined) {
    if (item === undefined) return { page, item: null };
    if (page === 'marketplace' && ITEM.test(item)) return { page, item };
  }
  return { page: 'not-found', item: path.slice(0, 200) };
}

export const routeHash = (route: Route) =>
  route.page === 'not-found'
    ? `#${route.item ?? ''}`
    : `#${route.page}${route.item ? `/${route.item}` : ''}`;

/**
 * Hash routing that works on static hosting. Legacy hashes are replaced (not
 * pushed) so the back button never lands on a retired route.
 */
export function useHashRoute(fallback: Page = 'borrow') {
  const [route, setRoute] = useState<Route>(() =>
    parseHash(window.location.hash, fallback),
  );

  useEffect(() => {
    const canonical = routeHash(parseHash(window.location.hash, fallback));
    if (window.location.hash !== canonical)
      window.history.replaceState(null, '', canonical);
    const sync = () => {
      const next = parseHash(window.location.hash, fallback);
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
