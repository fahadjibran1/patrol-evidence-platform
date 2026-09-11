import { isDesktopApp } from './desktop';
import type { AuthUser } from '../types';

export interface PersistedAuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

const STORAGE_KEY = 'patrol-evidence-auth';
const SECURE_KEY = 'desktop-auth-session';

function parseSession(raw: string | null): PersistedAuthSession | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedAuthSession> & { token?: string };
    const accessToken = parsed.accessToken ?? parsed.token;
    if (!accessToken || !parsed.refreshToken || !parsed.user?.id) {
      return null;
    }

    return {
      accessToken,
      refreshToken: parsed.refreshToken,
      user: parsed.user,
    };
  } catch {
    return null;
  }
}

export async function loadPersistedAuthSession(): Promise<PersistedAuthSession | null> {
  if (isDesktopApp() && window.desktopBridge?.secureStoreGet) {
    const secure = await window.desktopBridge.secureStoreGet(SECURE_KEY);
    const fromSecure = parseSession(secure);
    if (fromSecure) {
      // Remove legacy renderer token copies after a secure-store restore.
      localStorage.removeItem(STORAGE_KEY);
      return fromSecure;
    }

    const legacy = parseSession(localStorage.getItem(STORAGE_KEY));
    if (legacy) {
      if (window.desktopBridge.secureStoreSet) {
        await window.desktopBridge.secureStoreSet(SECURE_KEY, JSON.stringify(legacy));
      }
      localStorage.removeItem(STORAGE_KEY);
      return legacy;
    }
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  return parseSession(localStorage.getItem(STORAGE_KEY));
}

export async function savePersistedAuthSession(session: PersistedAuthSession): Promise<void> {
  const payload = JSON.stringify(session);

  if (isDesktopApp() && window.desktopBridge?.secureStoreSet) {
    await window.desktopBridge.secureStoreSet(SECURE_KEY, payload);
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  localStorage.setItem(STORAGE_KEY, payload);
}

export async function clearPersistedAuthSession(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
  if (isDesktopApp() && window.desktopBridge?.secureStoreClear) {
    await window.desktopBridge.secureStoreClear(SECURE_KEY);
  }
}
