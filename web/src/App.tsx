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
import { LicensePage } from './pages/license-page';
import { CompanySettingsPage } from './pages/company-settings-page';
import { SupportPage } from './pages/support-page';
import { DataProtectionPage } from './pages/data-protection-page';
import { LicenseRouteGate } from './components/license-route-gate';
import { apiRequest } from './lib/api';
import { getDesktopApiBaseUrl, isDesktopApp } from './lib/desktop';
import type { DesktopBootstrapStatus, DesktopState } from './types';
import { setWorkspaceTimeZone } from './lib/patrol-time';

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
  const { isLoading, token, refresh } = useAuth();
  const [bootstrapStatus, setBootstrapStatus] = useState<DesktopBootstrapStatus | null>(null);
  const [isBootstrapLoading, setIsBootstrapLoading] = useState(isDesktopApp());
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [desktopState, setDesktopState] = useState<DesktopState | null>(null);
  const [startupTimeoutReached, setStartupTimeoutReached] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

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

    // On desktop, wait until the backend is ready so startup delay does not clear the session.
    if (isDesktopApp()) {
      const status = desktopState?.backend.status;
      if (status !== 'ready' && !startupTimeoutReached) {
        return;
      }
    }

    void refresh().catch(() => {
      // Temporary backend/network failures keep the persisted session (see AuthProvider).
    });
  }, [refresh, token, desktopState?.backend.status, startupTimeoutReached]);

  useEffect(() => {
    if (!isDesktopApp()) {
      return;
    }

    const onSetupCompleted = (): void => {
      setBootstrapStatus((current) => current ? { ...current, setupCompleted: true } : current);
    };
    window.addEventListener('patrol:desktop-setup-completed', onSetupCompleted);
    return () => window.removeEventListener('patrol:desktop-setup-completed', onSetupCompleted);
  }, []);

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
      if (nextDesktopState.config.appTimeZone) {
        setWorkspaceTimeZone(nextDesktopState.config.appTimeZone);
      }
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

    async function loadDesktopBootstrap(reason: string): Promise<void> {
      setIsBootstrapLoading(true);
      try {
        const [status, nextDesktopState] = await Promise.all([
          apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status'),
          window.desktopBridge?.getState?.() ?? Promise.resolve(null),
        ]);
        if (cancelled) return;
        const configuredTimeZone = nextDesktopState?.config.appTimeZone ?? status.appTimeZone;
        if (configuredTimeZone) setWorkspaceTimeZone(configuredTimeZone);
        setBootstrapStatus(status);
        setDesktopState(nextDesktopState);
        setBootstrapError(null);
        console.info(
          `[frontend-bootstrap-status] reason=${reason} setupCompleted=${status.setupCompleted} backend=${
            nextDesktopState?.backend.status ?? 'unknown'
          }`,
        );
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to load desktop bootstrap';
        setBootstrapError(message);
        window.__patrolFrontendLastError = message;
        console.error('[frontend-bootstrap-failed]', error);
      } finally {
        if (!cancelled) setIsBootstrapLoading(false);
      }
    }

    // Electron owns backend readiness and does not load this renderer until the
    // spawned backend has passed the authenticated identity handshake.
    void loadDesktopBootstrap('electron-verified-ready');

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

        const configuredTimeZone = nextDesktopState?.config.appTimeZone ?? status.appTimeZone;
        if (configuredTimeZone) setWorkspaceTimeZone(configuredTimeZone);
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
        title="Starting PatrolSafe is taking longer than expected"
        reason="The desktop app is still waiting for local startup checks to complete."
        status={frontendBootStatus}
      />
    );
  }

  if (isLoading || isBootstrapLoading) {
    return <StartupLoadingPage status={frontendBootStatus} />;
  }

  const setupCompleted = bootstrapStatus?.setupCompleted === true;
  const shouldForceDesktopSetup = isDesktopApp() && !setupCompleted;

  return (
    <Routes>
      <Route
        path="/desktop/setup"
        element={
          setupCompleted
            ? <Navigate to={token ? '/' : '/login'} replace state={token ? undefined : { message: 'Please sign in to continue.' }} />
            : <DesktopSetupPage />
        }
      />
      <Route
        path="/login"
        element={token ? <Navigate to="/" replace /> : shouldForceDesktopSetup ? <Navigate to="/desktop/setup" replace /> : <LoginPage />}
      />
      <Route
        path="/"
        element={
          shouldForceDesktopSetup ? (
            <Navigate to="/desktop/setup" replace />
          ) : (
            <ProtectedRoute token={token}>
              <LicenseRouteGate>
                <MonitoringProvider>
                  <AppLayout />
                </MonitoringProvider>
              </LicenseRouteGate>
            </ProtectedRoute>
          )
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="sites" element={<SitesPage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="collector" element={<CollectorPage />} />
        <Route path="license" element={<LicensePage />} />
        <Route path="settings" element={<Navigate to="/settings/company" replace />} />
        <Route path="settings/company" element={<CompanySettingsPage />} />
        <Route path="settings/support" element={<SupportPage />} />
        <Route path="settings/backup" element={<DataProtectionPage />} />
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
        <img className="startup-brand-icon" src="./patrolsafe-icon.png" alt="" width="64" height="64" />
        <p className="eyebrow">PatrolSafe by S4</p>
        <h1>Starting PatrolSafe...</h1>
        <p className="muted-text">
          Your workspace and patrol records are being prepared.
        </p>
        <div className="loading-block customer-startup-loading" role="status" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <span>Please wait</span>
        </div>
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
        <img className="startup-brand-icon" src="./patrolsafe-icon.png" alt="" width="64" height="64" />
        <p className="eyebrow">PatrolSafe support</p>
        <h1>{title}</h1>
        <p className="muted-text">
          Your data has not been changed. Close PatrolSafe, reopen it and try again. If the issue continues, contact PatrolSafe support.
        </p>
        <details className="customer-details startup-support-details">
          <summary>Show support details</summary>
          <div className="frontend-diagnostics-log">
            <strong>Last startup issue</strong>
            <pre>{reason}</pre>
          </div>
          <StatusGrid status={status} />
        </details>
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
