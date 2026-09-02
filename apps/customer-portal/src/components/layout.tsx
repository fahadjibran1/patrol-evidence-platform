import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  canManageInvitations,
  canManageOrg,
  canManageUsers,
  canViewActivity,
  canViewBilling,
} from '../lib/permissions';

export function AppLayout(): JSX.Element {
  const navigate = useNavigate();
  const { customer, logout } = useAuth();

  const navItems = [
    { to: '/', label: 'Dashboard' },
    { to: '/licences', label: 'My licences' },
    { to: '/notifications', label: 'Notifications' },
    { to: '/users', label: 'Users', show: canManageUsers(customer) },
    { to: '/invitations', label: 'Invitations', show: canManageInvitations(customer) },
    { to: '/organisation', label: 'Organisation', show: canManageOrg(customer) || true },
    { to: '/sessions', label: 'Sessions' },
    { to: '/activity', label: 'Activity', show: canViewActivity(customer) },
    { to: '/billing', label: 'Billing', show: canViewBilling(customer) },
    { to: '/profile', label: 'Profile' },
  ].filter((item) => item.show !== false);

  return (
    <div className="shell">
      <aside className="sidebar compact">
        <div>
          <p className="eyebrow">Patrol · Customer</p>
          <h1>Licence Portal</h1>
          <p className="sidebar-copy">Organisation licences and team access</p>
        </div>
        <nav className="nav" aria-label="Primary">
          {navItems.map((item) => (
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
            <strong>{customer?.displayName}</strong>
            <p>{customer?.role?.replace(/_/g, ' ')}</p>
            <p>{customer?.email}</p>
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

export function ProtectedRoute({ token, children }: { token: string | null; children: JSX.Element }): JSX.Element {
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
