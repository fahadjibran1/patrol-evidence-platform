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
import { ApiError, apiRequest, registerAuthRefreshHandler } from '../lib/api';
import {
  clearPersistedAuthSession,
  loadPersistedAuthSession,
  savePersistedAuthSession,
  type PersistedAuthSession,
} from '../lib/auth-session-store';
import type { AuthUser, LoginResponse } from '../types';

export type AuthConnectionState = 'online' | 'reconnecting' | 'offline';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  connectionState: AuthConnectionState;
  login: (email: string, password: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  ensureFreshAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function isPermanentAuthFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  if (error.status === 401) {
    return true;
  }

  if (error.status === 403) {
    const message = error.message.toLowerCase();
    return message.includes('inactive') || message.includes('disabled') || message.includes('pending approval');
  }

  return false;
}

function isTemporaryFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return true;
  }

  return error.status >= 500 || error.status === 0 || error.status === 408 || error.status === 429;
}

export function AuthProvider({ children }: PropsWithChildren): JSX.Element {
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionState, setConnectionState] = useState<AuthConnectionState>('online');
  const refreshInFlight = useRef<Promise<string | null> | null>(null);
  const sessionRef = useRef<PersistedAuthSession | null>(null);

  const persistSession = useCallback(async (session: PersistedAuthSession | null) => {
    sessionRef.current = session;
    if (!session) {
      await clearPersistedAuthSession();
      return;
    }
    await savePersistedAuthSession(session);
  }, []);

  const clearSession = useCallback(
    async (reason: string) => {
      console.info(`[auth] ${reason}`);
      setToken(null);
      setRefreshToken(null);
      setUser(null);
      setConnectionState('online');
      await persistSession(null);
    },
    [persistSession],
  );

  const applySession = useCallback(
    async (session: PersistedAuthSession) => {
      setToken(session.accessToken);
      setRefreshToken(session.refreshToken);
      setUser(session.user);
      setConnectionState('online');
      await persistSession(session);
    },
    [persistSession],
  );

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    const currentRefresh = sessionRef.current?.refreshToken ?? refreshToken;
    if (!currentRefresh) {
      return null;
    }

    refreshInFlight.current = (async () => {
      try {
        const response = await apiRequest<LoginResponse>(
          '/auth/refresh',
          {
            method: 'POST',
            body: JSON.stringify({ refreshToken: currentRefresh }),
          },
          undefined,
          { skipRefresh: true },
        );

        await applySession({
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          user: response.user,
        });
        console.info('[auth] AUTH_ACCESS_TOKEN_REFRESHED');
        return response.accessToken;
      } catch (error) {
        if (isPermanentAuthFailure(error)) {
          console.warn('[auth] AUTH_SESSION_REVOKED');
          await clearSession('AUTH_SESSION_REVOKED');
          return null;
        }

        console.warn('[auth] AUTH_REFRESH_TEMPORARY_FAILURE');
        setConnectionState('reconnecting');
        throw error;
      } finally {
        refreshInFlight.current = null;
      }
    })();

    return refreshInFlight.current;
  }, [applySession, clearSession, refreshToken]);

  useEffect(() => {
    registerAuthRefreshHandler(() => refreshAccessToken());
    return () => registerAuthRefreshHandler(null);
  }, [refreshAccessToken]);

  useEffect(() => {
    let cancelled = false;

    async function restore(): Promise<void> {
      try {
        const stored = await loadPersistedAuthSession();
        if (cancelled) {
          return;
        }

        if (!stored) {
          setIsLoading(false);
          return;
        }

        if (!stored.accessToken || !stored.refreshToken || !stored.user?.id) {
          console.warn('[auth] AUTH_PERSISTED_SESSION_CORRUPT');
          await clearPersistedAuthSession();
          setIsLoading(false);
          return;
        }

        sessionRef.current = stored;
        setToken(stored.accessToken);
        setRefreshToken(stored.refreshToken);
        setUser(stored.user);
        console.info('[auth] AUTH_SESSION_RESTORED');
      } catch {
        console.warn('[auth] AUTH_PERSISTED_SESSION_CORRUPT');
        await clearPersistedAuthSession();
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      refreshToken,
      isLoading,
      connectionState,
      async login(email: string, password: string) {
        const response = await apiRequest<LoginResponse>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });

        await applySession({
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          user: response.user,
        });
        return response;
      },
      async logout() {
        const current = sessionRef.current;
        try {
          if (current?.accessToken) {
            await apiRequest(
              '/auth/logout',
              {
                method: 'POST',
                body: JSON.stringify({ refreshToken: current.refreshToken }),
              },
              current.accessToken,
              { skipRefresh: true },
            );
          }
        } catch {
          // Explicit logout still clears local session even if the backend is unreachable.
        }

        console.info('[auth] AUTH_EXPLICIT_LOGOUT');
        await clearSession('AUTH_EXPLICIT_LOGOUT');
      },
      async refresh() {
        const access = sessionRef.current?.accessToken ?? token;
        const currentRefresh = sessionRef.current?.refreshToken ?? refreshToken;
        if (!access && !currentRefresh) {
          setUser(null);
          return;
        }

        try {
          if (access) {
            const refreshedUser = await apiRequest<AuthUser>('/auth/me', {}, access, { skipRefresh: true });
            setUser(refreshedUser);
            setConnectionState('online');
            if (sessionRef.current) {
              await persistSession({ ...sessionRef.current, user: refreshedUser });
            }
            return;
          }
        } catch (error) {
          if (error instanceof ApiError && error.status === 401 && currentRefresh) {
            try {
              const nextAccess = await refreshAccessToken();
              if (!nextAccess) {
                return;
              }
              const refreshedUser = await apiRequest<AuthUser>('/auth/me', {}, nextAccess, { skipRefresh: true });
              setUser(refreshedUser);
              setConnectionState('online');
              return;
            } catch (refreshError) {
              if (isTemporaryFailure(refreshError)) {
                setConnectionState('reconnecting');
                return;
              }
              throw refreshError;
            }
          }

          if (isTemporaryFailure(error)) {
            console.warn('[auth] AUTH_REFRESH_TEMPORARY_FAILURE');
            setConnectionState('reconnecting');
            return;
          }

          if (isPermanentAuthFailure(error)) {
            if (error instanceof ApiError && error.status === 403) {
              console.warn('[auth] AUTH_ACCOUNT_DISABLED');
            }
            await clearSession('AUTH_SESSION_REVOKED');
          }
          return;
        }

        if (currentRefresh) {
          await refreshAccessToken();
        }
      },
      async ensureFreshAccessToken() {
        const access = sessionRef.current?.accessToken ?? token;
        if (access) {
          return access;
        }
        return refreshAccessToken();
      },
    }),
    [
      applySession,
      clearSession,
      connectionState,
      isLoading,
      persistSession,
      refreshAccessToken,
      refreshToken,
      token,
      user,
    ],
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
