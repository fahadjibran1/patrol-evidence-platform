import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { apiRequest } from './api';
import { STORAGE_KEY } from './dates';
import type { AdminUser, LoginResponse, RefreshResponse } from '../types';

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  admin: AdminUser;
}

interface AuthContextValue {
  admin: AdminUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredAuth(): StoredAuth | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as StoredAuth;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function writeStoredAuth(value: StoredAuth | null): void {
  if (!value) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function AuthProvider({ children }: PropsWithChildren): JSX.Element {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const persist = useCallback((next: StoredAuth | null) => {
    writeStoredAuth(next);
    setAccessToken(next?.accessToken ?? null);
    setRefreshToken(next?.refreshToken ?? null);
    setAdmin(next?.admin ?? null);
  }, []);

  useEffect(() => {
    const stored = readStoredAuth();
    if (stored) {
      setAccessToken(stored.accessToken);
      setRefreshToken(stored.refreshToken);
      setAdmin(stored.admin);
    }

    setIsLoading(false);
  }, []);

  const refreshSession = useCallback(async () => {
    const currentRefresh = refreshToken ?? readStoredAuth()?.refreshToken;
    if (!currentRefresh) {
      persist(null);
      return;
    }

    const response = await apiRequest<RefreshResponse>('/admin/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: currentRefresh }),
    });

    const currentAdmin = admin ?? readStoredAuth()?.admin;
    if (!currentAdmin) {
      persist(null);
      return;
    }

    persist({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      admin: currentAdmin,
    });

    const me = await apiRequest<AdminUser>('/admin/auth/me', {}, response.accessToken);
    persist({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      admin: me,
    });
  }, [admin, persist, refreshToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      admin,
      accessToken,
      refreshToken,
      isLoading,
      async login(email: string, password: string) {
        const response = await apiRequest<LoginResponse>('/admin/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });

        persist({
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          admin: response.admin,
        });

        return response;
      },
      async logout() {
        const token = accessToken ?? readStoredAuth()?.accessToken;
        const storedRefresh = refreshToken ?? readStoredAuth()?.refreshToken;

        persist(null);

        if (token && storedRefresh) {
          try {
            await apiRequest('/admin/auth/logout', {
              method: 'POST',
              body: JSON.stringify({ refreshToken: storedRefresh }),
            }, token);
          } catch {
            // Session cleared locally regardless.
          }
        }
      },
      refreshSession,
    }),
    [accessToken, admin, isLoading, persist, refreshSession, refreshToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
