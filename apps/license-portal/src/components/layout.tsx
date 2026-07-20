import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { canManageAdmins } from '../lib/roles';
import type { AdminRole } from '../types';

const navItems: Array<{ to: string; label: string; roles?: AdminRole[] }> = [
  { to: '/', label: 'Dashboard' },
  { to: '/customers', label: 'Customers' },
  { to: '/licences', label: 'Licences' },
  { to: '/payments', label: 'Payments' },
  { to: '/audit', label: 'Audit log' },
  { to: '/admins', label: 'Admin users', roles: ['SUPER_ADMIN'] },
  { to: '/settings', label: 'Settings' },
];

export function AppLayout(): JSX.Element {
  const navigate = useNavigate();
  const { admin, logout } = useAuth();

  const visibleItems = navItems.filter((item) => {
    if (!item.roles) {
      return true;
    }

    return admin?.role ? item.roles.includes(admin.role) : false;
  });

  return (
    <div className="shell">
      <aside className="sidebar compact">
        <div>
          <p className="eyebrow">Patrol · Internal</p>
          <h1>Licence Portal</h1>
          <p className="sidebar-copy">TG1 signing administration</p>
        </div>

        <nav className="nav" aria-label="Primary">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="user-card">
          <div>
            <strong>{admin?.displayName}</strong>
            <p>{admin?.role?.replace(/_/g, ' ')}</p>
            <p>{admin?.email}</p>
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
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export function OfflineEnforcementBanner(): JSX.Element {
  return (
    <div className="banner banner-warning" role="status">
      <strong>Offline enforcement limitation</strong>
      <p>
        Suspension and revocation update portal records only. Offline desktop licences already activated
        cannot be remotely disabled until online activation is introduced in a later phase.
      </p>
    </div>
  );
}

export function ProtectedRoute({ token, children }: { token: string | null; children: JSX.Element }): JSX.Element {
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export function SuperAdminRoute({
  role,
  children,
}: {
  role: AdminRole | undefined;
  children: JSX.Element;
}): JSX.Element {
  if (!canManageAdmins(role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
