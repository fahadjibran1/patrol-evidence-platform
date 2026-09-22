import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { canIssueLicences, canViewSystemStatus } from './lib/roles';
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
import { SystemStatusPage } from './pages/system-status-page';
import { BillingPlansPage } from './pages/billing-plans-page';
import { BillingSubscriptionsPage } from './pages/billing-subscriptions-page';
import { BillingInvoicesPage } from './pages/billing-invoices-page';
import { BillingPaymentsPage } from './pages/billing-payments-page';
import { BillingManualPaymentPage } from './pages/billing-manual-payment-page';
import { BillingSelfServiceReportPage } from './pages/billing-self-service-report-page';
import { StripeOperationsPage } from './pages/stripe-operations-page';
import { SupportOpsPage } from './pages/support-ops-page';
import { canManageBilling } from './lib/roles';
import { CommercialApprovalsPage } from './pages/commercial-approvals-page';

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

function SystemStatusRoute(): JSX.Element {
  const { admin } = useAuth();
  if (!canViewSystemStatus(admin?.role)) {
    return <Navigate to="/" replace />;
  }
  return <SystemStatusPage />;
}

function BillingManualPaymentRoute(): JSX.Element {
  const { admin } = useAuth();
  if (!canManageBilling(admin?.role)) {
    return <Navigate to="/billing/payments" replace />;
  }
  return <BillingManualPaymentPage />;
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
        <Route path="billing/plans" element={<BillingPlansPage />} />
        <Route path="billing/subscriptions" element={<BillingSubscriptionsPage />} />
        <Route path="billing/invoices" element={<BillingInvoicesPage />} />
        <Route path="billing/payments" element={<BillingPaymentsPage />} />
        <Route path="billing/manual-payment" element={<BillingManualPaymentRoute />} />
        <Route path="billing/self-service-report" element={<BillingSelfServiceReportPage />} />
        <Route path="stripe" element={<StripeOperationsPage />} />
        <Route path="commercial/approvals" element={<CommercialApprovalsPage />} />
        <Route path="support" element={<SupportOpsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="admins" element={<AdminsRoute />} />
        <Route path="system" element={<SystemStatusRoute />} />
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
