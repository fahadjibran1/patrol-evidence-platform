import { useEffect, useRef } from 'react';

/**
 * Polls on an interval only while the document tab is visible.
 * Refetches immediately when the tab becomes visible again.
 */
export function useVisibilityPolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const runIfVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void callbackRef.current();
      }
    };

    runIfVisible();

    const intervalId = window.setInterval(runIfVisible, intervalMs);
    document.addEventListener('visibilitychange', runIfVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', runIfVisible);
    };
  }, [enabled, intervalMs]);
}
