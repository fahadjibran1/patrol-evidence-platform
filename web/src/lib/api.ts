import type { ApiErrorPayload } from '../types';
import { getDesktopApiBaseUrl } from './desktop';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_API_URL = 'http://localhost:3000';

export function getApiBaseUrl(): string {
  const desktopBaseUrl = getDesktopApiBaseUrl();
  if (desktopBaseUrl) {
    return desktopBaseUrl.replace(/\/$/, '');
  }

  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/$/, '') : DEFAULT_API_URL;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);

  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });

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
