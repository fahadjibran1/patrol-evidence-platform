import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { apiRequest } from '../lib/api';
import type { AuthUser, LoginResponse } from '../types';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResponse>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = 'patrol-evidence-auth';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren): JSX.Element {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setIsLoading(false);
      return;
    }

    try {
      const parsed = JSON.parse(stored) as { token: string; user: AuthUser };
      setToken(parsed.token);
      setUser(parsed.user);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token || !user) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
  }, [token, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      async login(email: string, password: string) {
        const response = await apiRequest<LoginResponse>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });

        setToken(response.accessToken);
        setUser(response.user);
        return response;
      },
      logout() {
        setToken(null);
        setUser(null);
        localStorage.removeItem(STORAGE_KEY);
      },
      async refresh() {
        if (!token) {
          setUser(null);
          return;
        }

        const refreshed = await apiRequest<AuthUser>('/auth/me', {}, token);
        setUser(refreshed);
      },
    }),
    [isLoading, token, user],
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
