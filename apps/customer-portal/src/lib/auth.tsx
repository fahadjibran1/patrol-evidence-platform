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
import type { CustomerLoginResponse, CustomerRefreshResponse, CustomerUser } from '../types';

const STORAGE_KEY = 'patrol-customer-portal-auth';

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  customer: CustomerUser;
}

interface AuthContextValue {
  customer: CustomerUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredAuth(): StoredAuth | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed?.accessToken || !parsed?.refreshToken || !parsed?.customer?.id) {
      sessionStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function writeStoredAuth(value: StoredAuth | null, rememberMe = false): void {
  sessionStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
  if (!value) {
    return;
  }
  const serialized = JSON.stringify(value);
  if (rememberMe) {
    localStorage.setItem(STORAGE_KEY, serialized);
  } else {
    sessionStorage.setItem(STORAGE_KEY, serialized);
  }
}

function toCustomerUser(payload: CustomerLoginResponse['customer']): CustomerUser {
  return {
    id: payload.sub,
    email: payload.email,
    displayName: payload.displayName,
    customerId: payload.customerId,
    companyId: payload.companyId,
    role: payload.role,
    permissions: payload.permissions ?? [],
    emailVerified: payload.emailVerified,
  };
}

export function AuthProvider({ children }: PropsWithChildren): JSX.Element {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [rememberMe, setRememberMe] = useState(false);

  const persist = useCallback((next: StoredAuth | null, keepSignedIn = rememberMe) => {
    writeStoredAuth(next, keepSignedIn);
    setAccessToken(next?.accessToken ?? null);
    setRefreshToken(next?.refreshToken ?? null);
    setCustomer(next?.customer ?? null);
  }, [rememberMe]);

  useEffect(() => {
    const stored = readStoredAuth();
    if (stored) {
      setRememberMe(Boolean(localStorage.getItem(STORAGE_KEY)));
      persist(stored, Boolean(localStorage.getItem(STORAGE_KEY)));
    }
    setIsLoading(false);
  }, [persist]);

  const login = useCallback(async (email: string, password: string, keepSignedIn = false) => {
    const response = await apiRequest<CustomerLoginResponse>('/customer/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, rememberMe: keepSignedIn }),
    });
    setRememberMe(keepSignedIn || Boolean(response.tokens.rememberMe));
    persist(
      {
        accessToken: response.tokens.accessToken,
        refreshToken: response.tokens.refreshToken,
        customer: toCustomerUser(response.customer),
      },
      keepSignedIn || Boolean(response.tokens.rememberMe),
    );
  }, [persist]);

  const logout = useCallback(async () => {
    const currentAccess = accessToken ?? readStoredAuth()?.accessToken;
    const currentRefresh = refreshToken ?? readStoredAuth()?.refreshToken;
    try {
      if (currentAccess) {
        await apiRequest('/customer/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: currentRefresh }),
        }, currentAccess);
      }
    } catch {
      // ignore
    } finally {
      persist(null, false);
    }
  }, [accessToken, persist, refreshToken]);

  const refreshSession = useCallback(async () => {
    const currentRefresh = refreshToken ?? readStoredAuth()?.refreshToken;
    if (!currentRefresh) {
      persist(null, false);
      return;
    }
    const tokens = await apiRequest<CustomerRefreshResponse>('/customer/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: currentRefresh }),
    });
    const existing = readStoredAuth();
    if (!existing) {
      persist(null, false);
      return;
    }
    persist(
      {
        ...existing,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      Boolean(tokens.rememberMe) || rememberMe,
    );
  }, [persist, refreshToken, rememberMe]);

  const value = useMemo(
    () => ({ customer, accessToken, refreshToken, isLoading, login, logout, refreshSession }),
    [accessToken, customer, isLoading, login, logout, refreshSession, refreshToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
