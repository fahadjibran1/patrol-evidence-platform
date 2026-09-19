import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiRequest } from '../lib/api';
import { isDesktopApp } from '../lib/desktop';
import type { DesktopBootstrapStatus, LicenseStatusResponse } from '../types';
import { useAuth } from './auth';
import { projectAuthoritativeLicenceStatus } from './entitlement-state';

interface EntitlementContextValue {
  licenceStatus: LicenseStatusResponse | null;
  bootstrapStatus: DesktopBootstrapStatus | null;
  isLoading: boolean;
  refreshEntitlement: () => Promise<void>;
  reconcileEntitlement: (knownLicenceStatus?: LicenseStatusResponse) => Promise<void>;
}

const EntitlementContext = createContext<EntitlementContextValue | null>(null);

export function EntitlementProvider({ children }: PropsWithChildren): JSX.Element {
  const { token } = useAuth();
  const desktop = isDesktopApp();
  const [licenceStatus, setLicenceStatus] = useState<LicenseStatusResponse | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<DesktopBootstrapStatus | null>(null);
  const [isLoading, setIsLoading] = useState(desktop);
  const reconciliationSequence = useRef(0);
  const hasLoaded = useRef(!desktop);

  const reconcileEntitlement = useCallback(async (knownLicenceStatus?: LicenseStatusResponse): Promise<void> => {
    if (!desktop) {
      setIsLoading(false);
      return;
    }

    const sequence = ++reconciliationSequence.current;
    if (knownLicenceStatus) {
      setLicenceStatus(knownLicenceStatus);
      setBootstrapStatus((current) => current ? {
        ...current,
        companyName: knownLicenceStatus.companyName ?? current.companyName,
        license: projectAuthoritativeLicenceStatus(current.license, knownLicenceStatus),
      } : current);
    }
    if (!hasLoaded.current) {
      setIsLoading(true);
    }
    try {
      const [nextLicenceStatus, nextBootstrapStatus] = await Promise.all([
        apiRequest<LicenseStatusResponse>('/license/status', {}, token ?? undefined),
        apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status', {}, token ?? undefined),
      ]);
      if (sequence === reconciliationSequence.current) {
        setLicenceStatus(nextLicenceStatus);
        setBootstrapStatus(nextBootstrapStatus);
        hasLoaded.current = true;
      }
    } finally {
      if (sequence === reconciliationSequence.current) {
        setIsLoading(false);
      }
    }
  }, [desktop, token]);

  const refreshEntitlement = useCallback(async (): Promise<void> => {
    await reconcileEntitlement();
  }, [reconcileEntitlement]);

  useEffect(() => {
    if (!desktop) {
      setIsLoading(false);
      return;
    }
    if (!token) {
      setLicenceStatus(null);
      setBootstrapStatus(null);
      setIsLoading(false);
      reconciliationSequence.current += 1;
      hasLoaded.current = false;
      return;
    }

    let active = true;
    const refresh = (): void => {
      void reconcileEntitlement().catch(() => {
        if (active && !hasLoaded.current) {
          setLicenceStatus(null);
          setBootstrapStatus(null);
          setIsLoading(false);
        }
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [desktop, reconcileEntitlement, token]);

  const value = useMemo<EntitlementContextValue>(() => ({
    licenceStatus,
    bootstrapStatus,
    isLoading,
    refreshEntitlement,
    reconcileEntitlement,
  }), [
    bootstrapStatus,
    isLoading,
    licenceStatus,
    reconcileEntitlement,
    refreshEntitlement,
  ]);

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement(): EntitlementContextValue {
  const context = useContext(EntitlementContext);
  if (!context) {
    throw new Error('useEntitlement must be used within EntitlementProvider');
  }
  return context;
}
