import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { apiRequest } from './api';
import { normalizeAdmin, parseLoginResponse, safeResponseKeys } from './auth-response';
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

    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed?.accessToken || !parsed?.refreshToken || !parsed?.admin?.id) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
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

function logLoginDiagnostics(message: string, details: Record<string, unknown>): void {
  if (!import.meta.env.DEV) {
    return;
  }

  console.info(`[license-portal:login] ${message}`, details);
}

export function AuthProvider({ children }: PropsWithChildren): JSX.Element {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const sessionGenerationRef = useRef(0);

  const persist = useCallback((next: StoredAuth | null) => {
    writeStoredAuth(next);
    setAccessToken(next?.accessToken ?? null);
    setRefreshToken(next?.refreshToken ?? null);
    setAdmin(next?.admin ?? null);
  }, []);

  const refreshSession = useCallback(async () => {
    if (refreshInFlightRef.current) {
      await refreshInFlightRef.current;
      return;
    }

    const generation = sessionGenerationRef.current;
    const currentRefresh = refreshToken ?? readStoredAuth()?.refreshToken;
    if (!currentRefresh) {
      if (generation === sessionGenerationRef.current) {
        persist(null);
      }
      return;
    }

    const run = (async () => {
      const response = await apiRequest<RefreshResponse>('/admin/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: currentRefresh }),
      });

      // A newer login/logout won the race — do not overwrite it.
      if (generation !== sessionGenerationRef.current) {
        return;
      }

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

      const me = await apiRequest<unknown>('/admin/auth/me', {}, response.accessToken);
      if (generation !== sessionGenerationRef.current) {
        return;
      }

      persist({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        admin: normalizeAdmin(me),
      });
    })();

    refreshInFlightRef.current = run.finally(() => {
      refreshInFlightRef.current = null;
    });

    await refreshInFlightRef.current;
  }, [admin, persist, refreshToken]);

  useEffect(() => {
    // Restore from sessionStorage only. Do not call refresh on mount — that raced with
    // a fresh login and cleared valid sessions when refresh failed or returned late.
    // Explicit refreshSession() remains available; login bumps sessionGeneration so any
    // in-flight refresh cannot overwrite a newly authenticated session.
    const stored = readStoredAuth();
    if (stored) {
      sessionGenerationRef.current += 1;
      setAccessToken(stored.accessToken);
      setRefreshToken(stored.refreshToken);
      setAdmin(stored.admin);
    }
    setIsLoading(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      admin,
      accessToken,
      refreshToken,
      isLoading,
      async login(email: string, password: string) {
        const raw = await apiRequest<unknown>('/admin/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });

        logLoginDiagnostics('response received', {
          keys: safeResponseKeys(raw),
          hasAdmin: Boolean((raw as { admin?: unknown } | null)?.admin),
          hasTokens: Boolean((raw as { tokens?: unknown } | null)?.tokens),
        });

        let parsed;
        try {
          parsed = parseLoginResponse(raw);
        } catch (error) {
          logLoginDiagnostics('failure', {
            reason: 'malformed-response',
            keys: safeResponseKeys(raw),
            message: error instanceof Error ? error.message : 'Malformed login response',
          });
          throw error instanceof Error ? error : new Error('Malformed login response');
        }

        sessionGenerationRef.current += 1;
        persist({
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          admin: parsed.admin,
        });

        logLoginDiagnostics('success', {
          keys: safeResponseKeys(raw),
          redirectTarget: '/',
          adminEmail: parsed.admin.email,
          adminRole: parsed.admin.role,
        });

        return {
          admin: {
            sub: parsed.admin.id,
            email: parsed.admin.email,
            role: parsed.admin.role,
            displayName: parsed.admin.displayName,
          },
          tokens: {
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken,
            expiresIn: parsed.expiresIn,
          },
        };
      },
      async logout() {
        const token = accessToken ?? readStoredAuth()?.accessToken;
        const storedRefresh = refreshToken ?? readStoredAuth()?.refreshToken;

        sessionGenerationRef.current += 1;
        persist(null);

        if (token && storedRefresh) {
          try {
            await apiRequest(
              '/admin/auth/logout',
              {
                method: 'POST',
                body: JSON.stringify({ refreshToken: storedRefresh }),
              },
              token,
            );
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
