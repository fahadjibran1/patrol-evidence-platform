import { useCallback, useRef, useState } from 'react';
import { useVisibilityPolling } from './use-visibility-polling';

export function formatLastUpdated(value: Date | null): string {
  if (!value) {
    return 'Not updated yet';
  }

  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value);
}

export function useLiveRefresh(
  loadFn: () => Promise<void>,
  intervalMs: number,
  enabled = true,
): {
  lastUpdated: Date | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  markFiltersChanged: () => void;
} {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  const loadFnRef = useRef(loadFn);
  loadFnRef.current = loadFn;

  const runLoad = useCallback(async (options?: { showSpinner?: boolean }) => {
    const silent = hasLoadedRef.current && !options?.showSpinner;
    if (!silent) {
      setIsLoading(true);
    }

    try {
      await loadFnRef.current();
      setLastUpdated(new Date());
      hasLoadedRef.current = true;
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useVisibilityPolling(() => runLoad(), intervalMs, enabled);

  const refresh = useCallback(() => runLoad(), [runLoad]);

  const markFiltersChanged = useCallback(() => {
    hasLoadedRef.current = false;
    void runLoad({ showSpinner: true });
  }, [runLoad]);

  return {
    lastUpdated,
    isLoading,
    refresh,
    markFiltersChanged,
  };
}
