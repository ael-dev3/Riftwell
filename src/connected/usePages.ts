import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type Page } from './api';

export function apiMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error
    ? error.message
    : 'The service could not complete this request.';
}

/** Poll the pages already opened, so refreshed data does not erase pagination. */
export function usePages<T>(
  loader: (cursor: string | undefined, signal: AbortSignal) => Promise<Page<T>>,
  key: string,
) {
  const loadRef = useRef(loader);
  loadRef.current = loader;
  const [depth, setDepth] = useState(1);
  const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    setDepth(1);
    setItems([]);
    setNextCursor(null);
  }, [key]);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    async function load() {
      if (running || controller.signal.aborted || document.hidden) return;
      running = true;
      setLoading(true);
      try {
        const loaded: T[] = [];
        let cursor: string | undefined;
        for (let pageIndex = 0; pageIndex < depth; pageIndex++) {
          const page = await loadRef.current(cursor, controller.signal);
          loaded.push(...page.items);
          cursor = page.nextCursor ?? undefined;
          if (!cursor) break;
        }
        if (!controller.signal.aborted) {
          setItems(loaded);
          setNextCursor(cursor ?? null);
          setError('');
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(apiMessage(failure));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
        running = false;
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, depth, revision]);

  return {
    items,
    nextCursor,
    loading,
    error,
    refresh,
    loadMore: () => setDepth((value) => value + 1),
  };
}
