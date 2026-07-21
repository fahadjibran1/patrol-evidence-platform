import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { canIssueLicences } from './lib/roles';
import { AppLayout, ProtectedRoute, SuperAdminRoute } from './components/layout';
import { LoginPage } from './pages/login-page';
import { DashboardPage } from './pages/dashboard-page';
import { CustomersPage } from './pages/customers-page';
import { CustomerDetailPage } from './pages/customer-detail-page';
import { LicencesPage } from './pages/licences-page';
import { LicenceDetailPage } from './pages/licence-detail-page';
import { IssueLicencePage } from './pages/issue-licence-page';
import { RenewLicencePage } from './pages/renew-licence-page';
import { PaymentsPage } from './pages/payments-page';
import { AuditPage } from './pages/audit-page';
import { AdminsPage } from './pages/admins-page';
import { SettingsPage } from './pages/settings-page';

function IssueRoute({ children }: { children: JSX.Element }): JSX.Element {
  const { admin } = useAuth();
  if (!canIssueLicences(admin?.role)) {
    return <Navigate to="/licences" replace />;
  }

  return children;
}

function AdminsRoute(): JSX.Element {
  const { admin } = useAuth();
  return (
    <SuperAdminRoute role={admin?.role}>
      <AdminsPage />
    </SuperAdminRoute>
  );
}

function AppRoutes(): JSX.Element {
  const { accessToken, isLoading } = useAuth();

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
      <Route
        path="/"
        element={
          <ProtectedRoute token={accessToken}>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        <Route path="licences" element={<LicencesPage />} />
        <Route
          path="licences/issue"
          element={
            <IssueRoute>
              <IssueLicencePage />
            </IssueRoute>
          }
        />
        <Route path="licences/:id" element={<LicenceDetailPage />} />
        <Route
          path="licences/:id/renew"
          element={
            <IssueRoute>
              <RenewLicencePage />
            </IssueRoute>
          }
        />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="admins" element={<AdminsRoute />} />
        <Route path="settings" element={<SettingsPage />} />
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
