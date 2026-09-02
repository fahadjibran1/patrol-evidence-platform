import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, ErrorBanner, InfoBanner, LoadingState, PageHeader, StatusBadge } from '../components/ui';

interface CheckoutStatus {
  checkoutSessionId: string;
  status: string;
  subscription: {
    id: string;
    status: string;
    pendingCheckout: boolean;
    planCode: string;
    currentPeriodEnd: string | null;
  } | null;
  invoice: {
    id: string;
    number: string;
    status: string;
    total: number;
    currency: string;
  } | null;
  completedAt: string | null;
}

const MAX_POLLS = 20;
const POLL_MS = 2000;

export function CheckoutSuccessPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [params] = useSearchParams();
  const sessionId = params.get('session_id') ?? params.get('checkout_session_id');
  const [status, setStatus] = useState<CheckoutStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);

  const confirmed = useMemo(() => {
    if (!status) return false;
    return (
      status.subscription?.status === 'ACTIVE'
      || status.invoice?.status === 'PAID'
      || status.status === 'COMPLETE'
    );
  }, [status]);

  useEffect(() => {
    if (!accessToken || !sessionId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (attempt: number) => {
      try {
        const response = await apiRequest<CheckoutStatus>(
          `/customer/billing/checkout/${encodeURIComponent(sessionId)}/status`,
          {},
          accessToken,
        );
        if (cancelled) return;
        setStatus(response);
        setError(null);
        setPolls(attempt + 1);
        const done =
          response.subscription?.status === 'ACTIVE'
          || response.invoice?.status === 'PAID'
          || attempt + 1 >= MAX_POLLS;
        if (!done) {
          timer = setTimeout(() => void poll(attempt + 1), POLL_MS);
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load checkout status');
      }
    };

    void poll(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [accessToken, sessionId]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Checkout"
        subtitle="Payment confirmation is processed by our billing system after Stripe confirms payment."
      />

      {!sessionId ? (
        <ErrorBanner message="Missing checkout session reference. Return to Billing to check your subscription." />
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}

      <Card>
        {!status && !error ? <LoadingState label="Confirming payment status…" /> : null}

        {status && !confirmed ? (
          <InfoBanner
            title="Payment confirmation is being processed"
            message={`We are waiting for webhook reconciliation (${polls}/${MAX_POLLS}). Do not treat the Stripe redirect as proof of payment.`}
          />
        ) : null}

        {status && confirmed ? (
          <InfoBanner
            title="Subscription confirmed"
            message="Internal billing records show payment and subscription updates. You can download your licence from the Licences page once it is issued."
          />
        ) : null}

        {status ? (
          <div className="detail-grid" style={{ marginTop: '1rem' }}>
            <div className="detail-item">
              <span>Checkout status</span>
              <strong><StatusBadge value={status.status} /></strong>
            </div>
            <div className="detail-item">
              <span>Subscription</span>
              <strong>
                {status.subscription
                  ? <StatusBadge value={status.subscription.status} />
                  : '—'}
              </strong>
            </div>
            <div className="detail-item">
              <span>Invoice</span>
              <strong>
                {status.invoice
                  ? `${status.invoice.number} · ${status.invoice.status}`
                  : '—'}
              </strong>
            </div>
            <div className="detail-item">
              <span>Plan</span>
              <strong>{status.subscription?.planCode ?? '—'}</strong>
            </div>
          </div>
        ) : null}

        <div className="button-row" style={{ marginTop: '1.25rem' }}>
          <Link to="/billing" className="primary-button">Return to billing</Link>
          <Link to="/licences" className="secondary-button">View licences</Link>
        </div>
      </Card>
    </div>
  );
}
