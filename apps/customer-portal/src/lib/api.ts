import type { ApiErrorPayload } from '../types';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getApiBaseUrl(): string {
  const raw = (import.meta.env.VITE_LICENSE_API_URL as string | undefined)?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/$/, '') : '';
}

function formatApiError(payload: ApiErrorPayload, status: number): ApiError {
  let message = `Request failed with status ${status}`;
  if (Array.isArray(payload.message)) {
    message = payload.message.join(', ');
  } else if (typeof payload.message === 'string' && payload.message.length > 0) {
    message = payload.message;
  } else if (payload.error) {
    message = payload.error;
  }
  if (payload.code) {
    message = `${payload.code}: ${message}`;
  }
  return new ApiError(message, status, payload.code);
}

async function readBodyText(response: Response): Promise<string> {
  if (typeof response.text === 'function') {
    return response.text();
  }
  if (typeof response.json === 'function') {
    return JSON.stringify(await response.json());
  }
  return '';
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string | null,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await readBodyText(response);
    try {
      const payload = (text ? JSON.parse(text) : {}) as ApiErrorPayload;
      throw formatApiError(payload, response.status);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(text || `Request failed with status ${response.status}`, response.status);
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await readBodyText(response);
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function downloadAuthenticatedFile(
  path: string,
  fileName: string,
  accessToken: string,
): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const text = await readBodyText(response);
    try {
      const payload = (text ? JSON.parse(text) : {}) as ApiErrorPayload;
      throw formatApiError(payload, response.status);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(text || `Download failed with status ${response.status}`, response.status);
    }
  }

  const blob = await response.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(blobUrl);
}
