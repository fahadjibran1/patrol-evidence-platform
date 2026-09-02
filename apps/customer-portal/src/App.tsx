import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { AppLayout, ProtectedRoute } from './components/layout';
import { LoginPage } from './pages/login-page';
import { DashboardPage } from './pages/dashboard-page';
import { LicencesPage } from './pages/licences-page';
import { ProfilePage } from './pages/profile-page';
import { NotificationsPage } from './pages/notifications-page';
import { UsersPage } from './pages/users-page';
import { InvitationsPage } from './pages/invitations-page';
import { OrganisationPage } from './pages/organisation-page';
import { SessionsPage } from './pages/sessions-page';
import { ActivityPage } from './pages/activity-page';
import { ForgotPasswordPage } from './pages/forgot-password-page';
import { ResetPasswordPage } from './pages/reset-password-page';
import { AcceptInvitationPage } from './pages/accept-invitation-page';
import { canManageInvitations, canManageUsers, canViewActivity, canViewBilling } from './lib/permissions';
import { BillingPage } from './pages/billing-page';
import { BillingPlansComparePage } from './pages/billing-plans-compare-page';
import { BillingSettingsPage } from './pages/billing-settings-page';
import { CheckoutSuccessPage } from './pages/checkout-success-page';
import { CheckoutCancelledPage } from './pages/checkout-cancelled-page';

function RequirePermission({
  allowed,
  children,
}: {
  allowed: boolean;
  children: JSX.Element;
}): JSX.Element {
  if (!allowed) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function AppRoutes(): JSX.Element {
  const { accessToken, isLoading, customer } = useAuth();

  if (isLoading) {
    return (
      <div className="login-shell">
        <p>Loading session…</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={accessToken ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute token={accessToken}>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="licences" element={<LicencesPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route
          path="users"
          element={(
            <RequirePermission allowed={canManageUsers(customer)}>
              <UsersPage />
            </RequirePermission>
          )}
        />
        <Route
          path="invitations"
          element={(
            <RequirePermission allowed={canManageInvitations(customer)}>
              <InvitationsPage />
            </RequirePermission>
          )}
        />
        <Route path="organisation" element={<OrganisationPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route
          path="activity"
          element={(
            <RequirePermission allowed={canViewActivity(customer)}>
              <ActivityPage />
            </RequirePermission>
          )}
        />
        <Route
          path="billing"
          element={(
            <RequirePermission allowed={canViewBilling(customer)}>
              <BillingPage />
            </RequirePermission>
          )}
        />
        <Route
          path="billing/plans"
          element={(
            <RequirePermission allowed={canViewBilling(customer)}>
              <BillingPlansComparePage />
            </RequirePermission>
          )}
        />
        <Route
          path="billing/settings"
          element={(
            <RequirePermission allowed={canViewBilling(customer)}>
              <BillingSettingsPage />
            </RequirePermission>
          )}
        />
        <Route
          path="billing/checkout/success"
          element={(
            <RequirePermission allowed={canViewBilling(customer)}>
              <CheckoutSuccessPage />
            </RequirePermission>
          )}
        />
        <Route
          path="billing/checkout/cancelled"
          element={(
            <RequirePermission allowed={canViewBilling(customer)}>
              <CheckoutCancelledPage />
            </RequirePermission>
          )}
        />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to={accessToken ? '/' : '/login'} replace />} />
    </Routes>
  );
}

export function App(): JSX.Element {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
