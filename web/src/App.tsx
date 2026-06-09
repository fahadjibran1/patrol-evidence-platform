import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './state/auth';
import { AppLayout } from './components/layout';
import { MonitoringProvider } from './state/monitoring';
import { LoginPage } from './pages/login-page';
import { DashboardPage } from './pages/dashboard-page';
import { SitesPage } from './pages/sites-page';
import { SetupPage } from './pages/setup-page';
import { PatrolOpsPage } from './pages/patrol-ops-page';
import { EvidencePage } from './pages/evidence-page';
import { IncidentsPage } from './pages/incidents-page';
import { AlertsPage } from './pages/alerts-page';
import { CollectorPage } from './pages/collector-page';
import { AdvancedDiagnosticsPage } from './pages/advanced-diagnostics-page';
import { DesktopSetupPage } from './pages/desktop-setup-page';
import { GuardSafePage } from './pages/guard-safe-page';
import { apiRequest } from './lib/api';
import { getDesktopApiBaseUrl, isDesktopApp } from './lib/desktop';
import type { DesktopBootstrapStatus, DesktopState } from './types';

const DESKTOP_BOOTSTRAP_RETRY_WINDOW_MS = 15_000;
const DESKTOP_BOOTSTRAP_RETRY_INTERVAL_MS = 1_000;

interface FrontendBootStatus {
  frontendLoaded: boolean;
  desktopBridgeDetected: boolean;
  apiBaseUrl: string;
  backendStatus: string;
  lastFrontendError: string | null;
  currentRoute: string;
}

export function App(): JSX.Element {
  const location = useLocation();
  const { isLoading, token, refresh, logout } = useAuth();
  const [bootstrapStatus, setBootstrapStatus] = useState<DesktopBootstrapStatus | null>(null);
  const [isBootstrapLoading, setIsBootstrapLoading] = useState(isDesktopApp());
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [desktopState, setDesktopState] = useState<DesktopState | null>(null);
  const [startupTimeoutReached, setStartupTimeoutReached] = useState(false);

  const frontendBootStatus = useMemo<FrontendBootStatus>(() => ({
    frontendLoaded: true,
    desktopBridgeDetected: isDesktopApp(),
    apiBaseUrl: getDesktopApiBaseUrl() ?? 'Not detected',
    backendStatus: desktopState?.backend.status ?? 'unknown',
    lastFrontendError: window.__patrolFrontendLastError ?? null,
    currentRoute: `${location.pathname}${location.search}${location.hash}`,
  }), [desktopState?.backend.status, location.hash, location.pathname, location.search]);

  useEffect(() => {
    if (!token) {
      return;
    }

    refresh().catch(() => {
      logout();
    });
  }, [refresh, logout, token]);

  useEffect(() => {
    if (!isDesktopApp()) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setStartupTimeoutReached(true);
    }, 10_000);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!isDesktopApp() || !window.desktopBridge?.onBackendStatus) {
      return;
    }

    return window.desktopBridge.onBackendStatus((nextDesktopState) => {
      setDesktopState(nextDesktopState);
      console.info(`[frontend-backend-status] ${nextDesktopState.backend.status}`);
    });
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) {
      setIsBootstrapLoading(false);
      return;
    }

    let cancelled = false;

    async function loadDesktopBootstrapWithRetry(reason: string): Promise<void> {
      setIsBootstrapLoading(true);
      const startedAt = Date.now();
      let lastError: unknown = null;

      while (!cancelled && Date.now() - startedAt < DESKTOP_BOOTSTRAP_RETRY_WINDOW_MS) {
        try {
          const [status, nextDesktopState] = await Promise.all([
            apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status'),
            window.desktopBridge?.getState?.() ?? Promise.resolve(null),
          ]);

          if (cancelled) {
            return;
          }

          setBootstrapStatus(status);
          setDesktopState(nextDesktopState);
          setBootstrapError(null);
          setIsBootstrapLoading(false);
          console.info(
            `[frontend-bootstrap-status] reason=${reason} setupCompleted=${status.setupCompleted} backend=${
              nextDesktopState?.backend.status ?? 'unknown'
            }`,
          );
          return;
        } catch (error) {
          lastError = error;
          console.warn(
            `[frontend-bootstrap-retry] reason=${reason} message=${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          await new Promise((resolve) => window.setTimeout(resolve, DESKTOP_BOOTSTRAP_RETRY_INTERVAL_MS));
        }
      }

      if (cancelled) {
        return;
      }

      const message = lastError instanceof Error ? lastError.message : 'Failed to load desktop bootstrap';
      setBootstrapError(message);
      window.__patrolFrontendLastError = message;
      console.error('[frontend-bootstrap-failed]', lastError);
      setIsBootstrapLoading(false);
    }

    void loadDesktopBootstrapWithRetry('initial');

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) {
      return;
    }

    if (desktopState?.backend.status !== 'ready') {
      return;
    }

    if (!bootstrapError) {
      return;
    }

    let cancelled = false;

    async function recoverBootstrap(): Promise<void> {
      setIsBootstrapLoading(true);
      try {
        const [status, nextDesktopState] = await Promise.all([
          apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status'),
          window.desktopBridge?.getState?.() ?? Promise.resolve(null),
        ]);

        if (cancelled) {
          return;
        }

        setBootstrapStatus(status);
        setDesktopState(nextDesktopState);
        setBootstrapError(null);
        console.info('[frontend-bootstrap-recovered] backend=ready');
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load desktop bootstrap';
          setBootstrapError(message);
          window.__patrolFrontendLastError = message;
          console.error('[frontend-bootstrap-recovery-failed]', error);
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapLoading(false);
        }
      }
    }

    void recoverBootstrap();

    return () => {
      cancelled = true;
    };
  }, [bootstrapError, desktopState?.backend.status]);

  useEffect(() => {
    if (isLoading || isBootstrapLoading) {
      return;
    }

    console.info(
      `[frontend-route-ready] route=${location.pathname}${location.search}${location.hash} token=${
        token ? 'present' : 'missing'
      } bootstrapSetup=${bootstrapStatus?.setupCompleted ?? 'unknown'} backend=${desktopState?.backend.status ?? 'unknown'}`,
    );
  }, [
    bootstrapStatus?.setupCompleted,
    desktopState?.backend.status,
    isBootstrapLoading,
    isLoading,
    location.hash,
    location.pathname,
    location.search,
    token,
  ]);

  if (bootstrapError) {
    return <StartupRecoveryPage title="Startup check did not complete" reason={bootstrapError} status={frontendBootStatus} />;
  }

  if (startupTimeoutReached && (isLoading || isBootstrapLoading)) {
    return (
      <StartupRecoveryPage
        title="Starting Patrol Evidence Platform is taking longer than expected"
        reason="The desktop app is still waiting for local startup checks to complete."
        status={frontendBootStatus}
      />
    );
  }

  if (isLoading || isBootstrapLoading) {
    return <StartupLoadingPage status={frontendBootStatus} />;
  }

  const setupCompleted = bootstrapStatus?.setupCompleted === true;
  const shouldForceDesktopSetup = isDesktopApp() && !token && !setupCompleted;

  return (
    <Routes>
      <Route
        path="/desktop/setup"
        element={token ? <Navigate to="/" replace /> : <DesktopSetupPage />}
      />
      <Route
        path="/login"
        element={token ? <Navigate to="/" replace /> : shouldForceDesktopSetup ? <Navigate to="/desktop/setup" replace /> : <LoginPage />}
      />
      <Route
        path="/"
        element={
          <ProtectedRoute token={token}>
            <MonitoringProvider>
              <AppLayout />
            </MonitoringProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="sites" element={<SitesPage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="collector" element={<CollectorPage />} />
        <Route path="settings/diagnostics" element={<AdvancedDiagnosticsPage />} />
        <Route path="guard-safe" element={<GuardSafePage />} />
        <Route path="patrol" element={<PatrolOpsPage />} />
        <Route path="evidence" element={<EvidencePage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="alerts" element={<AlertsPage />} />
      </Route>
      <Route path="*" element={<Navigate to={token ? '/' : shouldForceDesktopSetup ? '/desktop/setup' : '/login'} replace />} />
    </Routes>
  );
}

function ProtectedRoute({
  token,
  children,
}: {
  token: string | null;
  children: JSX.Element;
}): JSX.Element {
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function StartupLoadingPage({ status }: { status: FrontendBootStatus }): JSX.Element {
  return (
    <div className="frontend-diagnostics-shell">
      <div className="frontend-diagnostics-card">
        <p className="eyebrow">Desktop Startup</p>
        <h1>Starting Patrol Evidence Platform...</h1>
        <p className="muted-text">
          The desktop screen is loading local services and checking the workstation status.
        </p>
        <StatusGrid status={status} />
      </div>
    </div>
  );
}

function StartupRecoveryPage({
  title,
  reason,
  status,
}: {
  title: string;
  reason: string;
  status: FrontendBootStatus;
}): JSX.Element {
  return (
    <div className="frontend-diagnostics-shell">
      <div className="frontend-diagnostics-card">
        <p className="eyebrow">Startup Recovery</p>
        <h1>{title}</h1>
        <p className="muted-text">
          Patrol Evidence Platform did not move past startup normally, so this recovery screen is shown instead of leaving the desktop window on the background.
        </p>
        <div className="frontend-diagnostics-log">
          <strong>Last startup issue</strong>
          <pre>{reason}</pre>
        </div>
        <StatusGrid status={status} />
      </div>
    </div>
  );
}

function StatusGrid({ status }: { status: FrontendBootStatus }): JSX.Element {
  return (
    <>
      <div className="frontend-diagnostics-grid">
        <div className="frontend-diagnostics-item">
          <span>Frontend loaded</span>
          <strong>{status.frontendLoaded ? 'Yes' : 'No'}</strong>
        </div>
        <div className="frontend-diagnostics-item">
          <span>Desktop bridge detected</span>
          <strong>{status.desktopBridgeDetected ? 'Yes' : 'No'}</strong>
        </div>
        <div className="frontend-diagnostics-item">
          <span>API base URL</span>
          <strong>{status.apiBaseUrl}</strong>
        </div>
        <div className="frontend-diagnostics-item">
          <span>Backend status</span>
          <strong>{status.backendStatus}</strong>
        </div>
      </div>
      <div className="frontend-diagnostics-log">
        <strong>Current route</strong>
        <pre>{status.currentRoute}</pre>
      </div>
      <div className="frontend-diagnostics-log">
        <strong>Last frontend error</strong>
        <pre>{status.lastFrontendError ?? 'No frontend error captured yet.'}</pre>
      </div>
    </>
  );
}
