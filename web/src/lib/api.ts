import type { ApiErrorPayload } from '../types';
import { getDesktopApiBaseUrl } from './desktop';
import { createTimedSignal, LOCAL_API_TIMEOUT_MS } from './api-timeout';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_API_URL = 'http://localhost:3000';

type RefreshHandler = () => Promise<string | null>;

let refreshHandler: RefreshHandler | null = null;
const refreshWaiters: Array<{
  resolve: (token: string | null) => void;
  reject: (error: unknown) => void;
}> = [];
let refreshPromise: Promise<string | null> | null = null;

export function registerAuthRefreshHandler(handler: RefreshHandler | null): void {
  refreshHandler = handler;
}

async function refreshAccessTokenOnce(): Promise<string | null> {
  if (!refreshHandler) {
    return null;
  }

  if (!refreshPromise) {
    refreshPromise = refreshHandler()
      .then((token) => {
        for (const waiter of refreshWaiters.splice(0)) {
          waiter.resolve(token);
        }
        return token;
      })
      .catch((error) => {
        for (const waiter of refreshWaiters.splice(0)) {
          waiter.reject(error);
        }
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return new Promise<string | null>((resolve, reject) => {
    if (!refreshPromise) {
      resolve(null);
      return;
    }

    refreshWaiters.push({ resolve, reject });
    void refreshPromise.then(resolve).catch(reject);
  });
}

export function getApiBaseUrl(): string {
  const desktopBaseUrl = getDesktopApiBaseUrl();
  if (desktopBaseUrl) {
    return desktopBaseUrl.replace(/\/$/, '');
  }

  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/$/, '') : DEFAULT_API_URL;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
  options?: { skipRefresh?: boolean },
): Promise<T> {
  const headers = new Headers(init.headers);

  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  const timedSignal = createTimedSignal(init.signal);
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers,
      signal: timedSignal.signal,
    });
  } catch (error) {
    if (timedSignal.didTimeout()) {
      throw new ApiError(
        `The local PatrolSafe service did not respond within ${LOCAL_API_TIMEOUT_MS / 1000} seconds. Retry after the desktop service is ready.`,
        408,
      );
    }
    throw new ApiError(error instanceof Error ? error.message : 'Network request failed', 0);
  } finally {
    timedSignal.cleanup();
  }

  if (response.status === 401 && token && !options?.skipRefresh && !path.includes('/auth/refresh') && !path.includes('/auth/login')) {
    try {
      const nextToken = await refreshAccessTokenOnce();
      if (nextToken && nextToken !== token) {
        return apiRequest<T>(path, init, nextToken, { skipRefresh: true });
      }
    } catch {
      // Fall through to throw the original 401.
    }
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const payload = (await response.json()) as ApiErrorPayload;
      if (Array.isArray(payload.message)) {
        message = payload.message.join(', ');
      } else if (typeof payload.message === 'string') {
        message = payload.message;
      } else if (payload.error) {
        message = payload.error;
      }
    } catch {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }

    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function downloadApiFile(path: string, token?: string): Promise<void> {
  const headers = new Headers();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, { headers });
  if (!response.ok) {
    throw new ApiError(`Request failed with status ${response.status}`, response.status);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/i);
  const fileName = match?.[1] ?? 'download.csv';
  const blobUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(blobUrl);
}
