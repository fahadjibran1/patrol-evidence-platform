import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { getPatrolToday } from '../lib/patrol-time';
import { formatMonitoringStateUpdateTime } from '../lib/monitoring-state';
import { useAuth } from '../state/auth';
import { useMonitoring } from '../state/monitoring';
import type { DesktopBootstrapStatus, UserRole } from '../types';
import { AboutButton } from './about-dialog';
import { BuildLabel } from './build-label';
import { PRODUCT_INFO } from '../lib/product-info';

const navItems: Array<{ to: string; label: string; roles: UserRole[] }> = [
  { to: '/', label: 'Dashboard', roles: ['ADMIN', 'COMPANY_ADMIN'] },
  { to: '/guard-safe', label: 'Guard Safe', roles: ['ADMIN', 'COMPANY_ADMIN'] },
  { to: '/evidence', label: 'Evidence', roles: ['ADMIN', 'COMPANY_ADMIN', 'GUARD'] },
  { to: '/alerts', label: 'Alerts', roles: ['ADMIN', 'COMPANY_ADMIN', 'GUARD'] },
  { to: '/incidents', label: 'Incidents', roles: ['ADMIN', 'COMPANY_ADMIN', 'GUARD'] },
  { to: '/patrol', label: 'Patrol Ops', roles: ['ADMIN', 'COMPANY_ADMIN', 'GUARD'] },
  { to: '/collector', label: 'Monitoring', roles: ['ADMIN', 'COMPANY_ADMIN'] },
  { to: '/license', label: 'Licence', roles: ['ADMIN', 'COMPANY_ADMIN'] },
  { to: '/setup', label: 'Setup', roles: ['ADMIN', 'COMPANY_ADMIN'] },
  { to: '/sites', label: 'Sites', roles: ['ADMIN', 'COMPANY_ADMIN'] },
  { to: '/settings/diagnostics', label: 'Diagnostics', roles: ['ADMIN', 'COMPANY_ADMIN'] },
];

function sidebarDotClass(tone: 'ready' | 'warning' | 'error' | 'idle'): string {
  if (tone === 'ready') {
    return 'ready';
  }

  if (tone === 'error') {
    return 'idle';
  }

  return tone === 'warning' ? 'warning' : 'idle';
}

export function AppLayout(): JSX.Element {
  const navigate = useNavigate();
  const { user, logout, token, connectionState } = useAuth();
  const { view, lastStateUpdateAt } = useMonitoring();
  const [bootstrapStatus, setBootstrapStatus] = useState<DesktopBootstrapStatus | null>(null);

  const visibleItems = navItems.filter((item) => item.roles.includes(user?.role ?? 'GUARD'));
  const currentBusinessDate = useMemo(() => getPatrolToday(), []);

  useEffect(() => {
    if (!token || user?.role === 'GUARD') {
      return;
    }

    void apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status', {}, token)
      .then(setBootstrapStatus)
      .catch(() => setBootstrapStatus(null));
  }, [token, user?.role]);

  const workspaceLabel = useMemo(() => {
    return bootstrapStatus?.workspaceName || bootstrapStatus?.companyName || 'PatrolSafe Workspace';
  }, [bootstrapStatus?.companyName, bootstrapStatus?.workspaceName]);

  const licenceSummary = useMemo(() => {
    const license = bootstrapStatus?.license;
    if (!license) {
      return 'Licence status unavailable';
    }

    if (license.status === 'NOT_ACTIVATED') {
      return 'Licence not activated';
    }

    if (license.displayMode === 'Licensed' && license.status === 'ACTIVE') {
      return 'Licensed';
    }

    if (license.status === 'ACTIVE' && license.plan === 'trial') {
      return `Trial: ${license.daysRemaining} day${license.daysRemaining === 1 ? '' : 's'} left`;
    }

    if (license.status === 'TRIAL_ACTIVE') {
      return `Trial: ${license.daysRemaining} day${license.daysRemaining === 1 ? '' : 's'} left`;
    }

    if (license.status === 'EXPIRED') {
      return 'Licence expired';
    }

    return license.message || 'Activation needed';
  }, [bootstrapStatus?.license]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <h1>{PRODUCT_INFO.brandName}</h1>
          <p className="brand-endorsement">{PRODUCT_INFO.endorsement}</p>
          <p className="sidebar-copy">{PRODUCT_INFO.tagline}</p>
          <p className="sidebar-workspace">{workspaceLabel}</p>
          {user?.role !== 'GUARD' ? (
            <div className="sidebar-status-strip">
              <span className={`status-dot ${sidebarDotClass(view.tone)}`} />
              <span>{view.sidebarLabel}</span>
            </div>
          ) : null}
        </div>

        <nav className="nav">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <span>{item.label}</span>
              {item.to === '/collector' && user?.role !== 'GUARD' ? (
                <span className={`nav-indicator ${sidebarDotClass(view.tone)}`} aria-hidden="true" />
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="user-card">
          <div>
            <strong>
              {user?.firstName} {user?.lastName}
            </strong>
            <p>{user?.role}</p>
            <p>{user?.email}</p>
            {user?.role !== 'GUARD' ? <p>{licenceSummary}</p> : null}
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void logout().finally(() => navigate('/login'));
            }}
          >
            Sign out
          </button>
          <AboutButton />
          <BuildLabel />
        </div>
      </aside>

      <main className="content">
        {connectionState === 'reconnecting' || connectionState === 'offline' ? (
          <div className="banner banner-warning" role="status">
            Reconnecting to the local control-room service. Your session is preserved.
          </div>
        ) : null}
        {user?.role !== 'GUARD' ? (
          <div className="app-topbar">
            <div className="app-topbar-block">
              <span className="app-topbar-label">Company</span>
              <strong>{bootstrapStatus?.companyName || workspaceLabel}</strong>
            </div>
            <div className="app-topbar-block">
              <span className="app-topbar-label">Licence</span>
              <strong>
                {bootstrapStatus?.license.displayMode === 'Licensed' && bootstrapStatus.license.status === 'ACTIVE'
                  ? 'Licensed'
                  : bootstrapStatus?.license.status === 'TRIAL_ACTIVE' ||
                      (bootstrapStatus?.license.status === 'ACTIVE' && bootstrapStatus.license.plan === 'trial')
                    ? `Trial: ${bootstrapStatus.license.daysRemaining} day${bootstrapStatus.license.daysRemaining === 1 ? '' : 's'} left`
                    : bootstrapStatus?.license.status === 'EXPIRED'
                      ? 'Licence expired'
                      : bootstrapStatus?.license.status === 'NOT_ACTIVATED'
                        ? 'Not activated'
                        : bootstrapStatus?.license.status ?? 'Unavailable'}
              </strong>
            </div>
            <div className="app-topbar-block">
              <span className="app-topbar-label">Monitoring</span>
              <strong>{view.headerLabel}</strong>
            </div>
            <div className="app-topbar-block">
              <span className="app-topbar-label">State updated</span>
              <strong>{formatMonitoringStateUpdateTime(lastStateUpdateAt)}</strong>
            </div>
            <div className="app-topbar-block">
              <span className="app-topbar-label">Date</span>
              <strong>{currentBusinessDate}</strong>
            </div>
          </div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
