import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { apiRequest } from '../lib/api';
import { isDesktopApp } from '../lib/desktop';
import type { LicenseStatusResponse } from '../types';

const LICENSE_ALLOWED_PATHS = new Set([
  '/license',
  '/login',
  '/settings/support',
  '/settings/diagnostics',
  '/settings/backup',
  '/evidence',
]);

export function LicenseRouteGate({ children }: { children?: ReactNode }): JSX.Element {
  const location = useLocation();
  const desktop = isDesktopApp();
  const [status, setStatus] = useState<LicenseStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(desktop);

  useEffect(() => {
    if (!desktop) {
      setIsLoading(false);
      return;
    }

    void apiRequest<LicenseStatusResponse>('/license/status')
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setIsLoading(false));
  }, [desktop]);

  if (!desktop) {
    return <>{children ?? <Outlet />}</>;
  }

  if (isLoading) {
    return (
      <div className="frontend-diagnostics-shell">
        <div className="frontend-diagnostics-card">
          <h1>Checking licence…</h1>
        </div>
      </div>
    );
  }

  const operationsAllowed =
    status?.operationsAllowed !== false &&
    (status?.status === 'ACTIVE' || status?.status === 'TRIAL_ACTIVE');
  if (operationsAllowed || LICENSE_ALLOWED_PATHS.has(location.pathname)) {
    return <>{children ?? <Outlet />}</>;
  }

  if (location.pathname !== '/license') {
    return <Navigate to="/license" replace state={{ from: location.pathname }} />;
  }

  return <>{children ?? <Outlet />}</>;
}
