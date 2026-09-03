export const LOCAL_API_TIMEOUT_MS = 30_000;

export interface TimedSignal {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
}

export function createTimedSignal(parent: AbortSignal | null | undefined, timeoutMs = LOCAL_API_TIMEOUT_MS): TimedSignal {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = (): void => controller.abort(parent?.reason);
  if (parent?.aborted) {
    abortFromParent();
  } else {
    parent?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Local API request timed out', 'TimeoutError'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      globalThis.clearTimeout(timeout);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}
