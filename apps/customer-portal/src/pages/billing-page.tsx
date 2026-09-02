import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { formatMoney, formatUkDate, formatUkDateTime } from '../lib/dates';
import { useAuth } from '../lib/auth';
import { canPurchaseBilling } from '../lib/permissions';
import {
  Card,
  ErrorBanner,
  InfoBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { BillingInterval } from '../types';

interface PaymentMethodSummary {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
}

interface BillingDashboard {
  organisation: {
    billingEmail: string;
    supportContact: string;
    taxId: string | null;
  };
  subscription: {
    id: string;
    status: string;
    billingInterval: BillingInterval;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    nextBillingDate: string | null;
    autoRenew: boolean;
    cancelAtPeriodEnd: boolean;
    trialActive?: boolean;
    renewalAmount?: number | null;
    gracePeriodDays?: number | null;
    pendingPlan?: { id: string; name: string; code: string } | null;
    scheduledChangeType?: string | null;
    planChangeEffectiveAt?: string | null;
    pendingCheckout?: boolean;
  } | null;
  plan: {
    id: string;
    name: string;
    code: string;
    monthlyPrice: number;
    annualPrice: number;
    currency: string;
    maxDevices: number;
    includedFeatures: string[];
    supportLevel: string;
  } | null;
  paymentMethod: PaymentMethodSummary | null;
  upcomingInvoice: {
    id: string;
    number: string;
    status: string;
    total: number;
    currency: string;
    dueAt: string | null;
  } | null;
  invoices: Array<{
    id: string;
    number: string;
    status: string;
    total: number;
    currency: string;
    issuedAt: string | null;
    dueAt: string | null;
    paidAt: string | null;
  }>;
  payments: Array<{
    id: string;
    invoiceId: string;
    invoiceNumber?: string | null;
    status: string;
    amount: number;
    currency: string;
    provider: string;
    manualMethod?: string | null;
    receivedAt?: string | null;
    createdAt: string;
  }>;
  planComparison: Array<{
    id: string;
    code: string;
    name: string;
    amount: number;
    currency: string;
    interval: BillingInterval;
    maxDevices: number;
    supportLevel: string;
    features: string[];
    isCurrent: boolean;
    isRecommended: boolean;
  }>;
  upgradeAvailable: boolean;
  downgradeAvailable: boolean;
  canCancel: boolean;
  canRenew: boolean;
  stripeCheckoutEnabled: boolean;
  termsVersion: string;
  canPurchase: boolean;
  deviceEntitlements: number | null;
  features: string[];
}

export function BillingPage(): JSX.Element {
  const { accessToken, customer } = useAuth();
  const [dashboard, setDashboard] = useState<BillingDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);

  async function reload(): Promise<void> {
    if (!accessToken) return;
    const response = await apiRequest<BillingDashboard>('/customer/billing', {}, accessToken);
    setDashboard(response);
    setError(null);
  }

  useEffect(() => {
    if (!accessToken) return;
    setIsLoading(true);
    void reload()
      .catch((loadError) => {
        setDashboard(null);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load billing');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  const canPurchase = canPurchaseBilling(customer) && Boolean(dashboard?.canPurchase);

  async function runAction(key: string, action: () => Promise<void>): Promise<void> {
    setBusy(key);
    setError(null);
    try {
      await action();
      await reload();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  async function startCheckoutRedirect(path: string, body: Record<string, unknown>): Promise<void> {
    if (!accessToken) return;
    const result = await apiRequest<{ checkoutUrl?: string | null; appliedImmediately?: boolean }>(
      path,
      { method: 'POST', body: JSON.stringify(body) },
      accessToken,
    );
    if (result.checkoutUrl) {
      window.location.assign(result.checkoutUrl);
      return;
    }
    await reload();
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Billing"
        subtitle="Subscription dashboard, plan changes, invoices, and payment methods."
        actions={(
          <div className="button-row">
            <Link to="/billing/plans" className="secondary-button">Compare plans</Link>
            <Link to="/billing/settings" className="secondary-button">Billing settings</Link>
          </div>
        )}
      />

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading billing…" /> : null}

      {!isLoading && dashboard ? (
        <>
          {dashboard.subscription?.status === 'PAST_DUE' ? (
            <InfoBanner
              title="Payment attention required"
              message={`Grace period: ${dashboard.subscription.gracePeriodDays ?? 7} days. Update your payment method or renew to restore normal billing.`}
            />
          ) : null}
          {dashboard.subscription?.cancelAtPeriodEnd ? (
            <InfoBanner
              title="Cancellation scheduled"
              message={`Access continues until ${formatUkDate(dashboard.subscription.currentPeriodEnd)}. You can undo cancellation below.`}
            />
          ) : null}
          {dashboard.subscription?.pendingPlan ? (
            <InfoBanner
              title={`Scheduled ${dashboard.subscription.scheduledChangeType?.toLowerCase() ?? 'plan change'}`}
              message={`${dashboard.subscription.pendingPlan.name} takes effect ${formatUkDate(dashboard.subscription.planChangeEffectiveAt)}.`}
            />
          ) : null}

          <Card>
            <h3>Current subscription</h3>
            {dashboard.subscription && dashboard.plan ? (
              <div className="detail-grid">
                <div className="detail-item"><span>Plan</span><strong>{dashboard.plan.name}</strong></div>
                <div className="detail-item"><span>Status</span><strong><StatusBadge value={dashboard.subscription.status} /></strong></div>
                <div className="detail-item"><span>Trial</span><strong>{dashboard.subscription.trialActive ? 'Active' : 'No'}</strong></div>
                <div className="detail-item"><span>Interval</span><strong>{dashboard.subscription.billingInterval}</strong></div>
                <div className="detail-item"><span>Current period</span><strong>{formatUkDate(dashboard.subscription.currentPeriodStart)} – {formatUkDate(dashboard.subscription.currentPeriodEnd)}</strong></div>
                <div className="detail-item"><span>Next renewal</span><strong>{formatUkDate(dashboard.subscription.nextBillingDate)}</strong></div>
                <div className="detail-item"><span>Renewal amount</span><strong>{formatMoney(dashboard.subscription.renewalAmount ?? 0, dashboard.plan.currency)}</strong></div>
                <div className="detail-item"><span>Devices</span><strong>{dashboard.deviceEntitlements ?? dashboard.plan.maxDevices}</strong></div>
                <div className="detail-item"><span>Support</span><strong>{dashboard.plan.supportLevel}</strong></div>
                <div className="detail-item"><span>Support contact</span><strong>{dashboard.organisation.supportContact}</strong></div>
              </div>
            ) : (
              <p className="muted">No active subscription. Use Checkout on the plans page to subscribe.</p>
            )}

            <div className="button-row" style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="primary-button"
                disabled={!canPurchase || !dashboard.canRenew || !acceptedTerms || busy === 'renew'}
                onClick={() => void runAction('renew', async () => {
                  await startCheckoutRedirect('/customer/billing/renew', {
                    acceptedTermsVersion: dashboard.termsVersion,
                  });
                })}
              >
                {busy === 'renew' ? 'Starting…' : 'Renew'}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!dashboard.stripeCheckoutEnabled || busy === 'portal'}
                onClick={() => void runAction('portal', async () => {
                  if (!accessToken) return;
                  const result = await apiRequest<{ url: string }>(
                    '/customer/billing/payment-method/portal',
                    { method: 'POST', body: '{}' },
                    accessToken,
                  );
                  window.location.assign(result.url);
                })}
              >
                Manage payment method
              </button>
            </div>
            <label className="checkbox-row" style={{ marginTop: '0.75rem' }}>
              <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
              <span>I accept billing terms {dashboard.termsVersion}</span>
            </label>
          </Card>

          <div className="split-grid">
            <Card>
              <h3>Payment method</h3>
              {dashboard.paymentMethod ? (
                <div className="detail-grid">
                  <div className="detail-item"><span>Brand</span><strong>{dashboard.paymentMethod.brand ?? 'Card'}</strong></div>
                  <div className="detail-item"><span>Last four</span><strong>•••• {dashboard.paymentMethod.last4}</strong></div>
                  <div className="detail-item"><span>Expiry</span><strong>{dashboard.paymentMethod.expMonth}/{dashboard.paymentMethod.expYear}</strong></div>
                  <div className="detail-item"><span>Default</span><strong>{dashboard.paymentMethod.isDefault ? 'Yes' : 'No'}</strong></div>
                </div>
              ) : (
                <p className="muted">No card on file. Use Manage payment method to add one via Stripe.</p>
              )}
            </Card>
            <Card>
              <h3>Upcoming invoice</h3>
              {dashboard.upcomingInvoice ? (
                <div className="detail-grid">
                  <div className="detail-item"><span>Number</span><strong>{dashboard.upcomingInvoice.number}</strong></div>
                  <div className="detail-item"><span>Status</span><strong><StatusBadge value={dashboard.upcomingInvoice.status} /></strong></div>
                  <div className="detail-item"><span>Total</span><strong>{formatMoney(dashboard.upcomingInvoice.total, dashboard.upcomingInvoice.currency)}</strong></div>
                  <div className="detail-item"><span>Due</span><strong>{formatUkDate(dashboard.upcomingInvoice.dueAt)}</strong></div>
                </div>
              ) : (
                <p className="muted">No open invoice.</p>
              )}
            </Card>
          </div>

          <Card>
            <h3>Included features</h3>
            {(dashboard.features as string[]).length ? (
              <ul>
                {(dashboard.features as string[]).map((feature) => (
                  <li key={feature}>{feature.replace(/_/g, ' ')}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">No feature list on current plan.</p>
            )}
          </Card>

          <Card>
            <h3>Plan changes</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Price</th>
                    <th>Devices</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.planComparison.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.name}
                        {row.isCurrent ? ' (current)' : ''}
                        {row.isRecommended ? ' · recommended' : ''}
                      </td>
                      <td>{formatMoney(row.amount, row.currency)} / {row.interval.toLowerCase()}</td>
                      <td>{row.maxDevices}</td>
                      <td>
                        <div className="button-row">
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={!canPurchase || row.isCurrent || busy === `up-${row.id}`}
                            onClick={() => void runAction(`up-${row.id}`, async () => {
                              if (!accessToken) return;
                              const result = await apiRequest<Record<string, unknown>>(
                                '/customer/billing/upgrade/preview',
                                { method: 'POST', body: JSON.stringify({ planId: row.id, billingInterval: row.interval }) },
                                accessToken,
                              );
                              setPreview(result);
                            })}
                          >
                            Preview upgrade
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            disabled={!canPurchase || !acceptedTerms || row.isCurrent || busy === `confirm-${row.id}`}
                            onClick={() => void runAction(`confirm-${row.id}`, async () => {
                              await startCheckoutRedirect('/customer/billing/upgrade', {
                                planId: row.id,
                                billingInterval: row.interval,
                                acceptedTermsVersion: dashboard.termsVersion,
                              });
                            })}
                          >
                            Upgrade
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={!canPurchase || row.isCurrent || busy === `down-${row.id}`}
                            onClick={() => void runAction(`down-${row.id}`, async () => {
                              if (!accessToken) return;
                              await apiRequest(
                                '/customer/billing/downgrade',
                                { method: 'POST', body: JSON.stringify({ planId: row.id, billingInterval: row.interval }) },
                                accessToken,
                              );
                            })}
                          >
                            Schedule downgrade
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview ? (
              <InfoBanner
                title="Upgrade preview"
                message={`Proration estimate: ${JSON.stringify((preview as { estimate?: { prorationAmount?: number } }).estimate?.prorationAmount ?? 0)} minor units. Effective immediately after payment.`}
              />
            ) : null}
            {dashboard.subscription?.pendingPlan ? (
              <button
                type="button"
                className="secondary-button"
                style={{ marginTop: '1rem' }}
                disabled={busy === 'cancel-change'}
                onClick={() => void runAction('cancel-change', async () => {
                  if (!accessToken) return;
                  await apiRequest('/customer/billing/plan-change/cancel', { method: 'POST', body: '{}' }, accessToken);
                })}
              >
                Cancel scheduled plan change
              </button>
            ) : null}
          </Card>

          <Card>
            <h3>Cancellation</h3>
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void runAction('cancel', async () => {
                  if (!accessToken) return;
                  await apiRequest(
                    '/customer/billing/cancel',
                    { method: 'POST', body: JSON.stringify({ atPeriodEnd: true, reason: cancelReason || undefined }) },
                    accessToken,
                  );
                });
              }}
            >
              <label>
                Reason
                <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={500} />
              </label>
              <div className="button-row" style={{ marginTop: '0.75rem' }}>
                <button type="submit" className="secondary-button" disabled={!canPurchase || !dashboard.canCancel || busy === 'cancel'}>
                  Cancel at period end
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!dashboard.subscription?.cancelAtPeriodEnd || busy === 'undo'}
                  onClick={() => void runAction('undo', async () => {
                    if (!accessToken) return;
                    await apiRequest('/customer/billing/cancel/undo', { method: 'POST', body: '{}' }, accessToken);
                  })}
                >
                  Undo cancellation
                </button>
              </div>
            </form>
          </Card>

          <Card>
            <h3>Billing history</h3>
            <h4>Invoices</h4>
            {dashboard.invoices.length === 0 ? <p className="muted">No invoices yet.</p> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Issued</th>
                      <th>Due</th>
                      <th>PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>{invoice.number}</td>
                        <td><StatusBadge value={invoice.status} /></td>
                        <td>{formatMoney(invoice.total, invoice.currency)}</td>
                        <td>{formatUkDate(invoice.issuedAt)}</td>
                        <td>{formatUkDate(invoice.dueAt)}</td>
                        <td><button type="button" className="secondary-button" disabled title="PDF export coming soon">Download</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h4 style={{ marginTop: '1.5rem' }}>Payments</h4>
            {dashboard.payments.length === 0 ? <p className="muted">No payments recorded yet.</p> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Status</th>
                      <th>Amount</th>
                      <th>Method</th>
                      <th>Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>{payment.invoiceNumber ?? payment.invoiceId}</td>
                        <td><StatusBadge value={payment.status} /></td>
                        <td>{formatMoney(payment.amount, payment.currency)}</td>
                        <td>{payment.manualMethod?.replace(/_/g, ' ') ?? payment.provider}</td>
                        <td>{formatUkDateTime(payment.receivedAt ?? payment.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ marginTop: '1rem' }}>Refunds will appear here when refund automation is enabled.</p>
          </Card>
        </>
      ) : null}
    </div>
  );
}
