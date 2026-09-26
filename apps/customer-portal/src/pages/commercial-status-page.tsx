import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  commercialStagingEnabled,
  getCommercialOrderStatus,
  PUBLIC_ORDER_PATTERN,
  type CommercialPublicOrderStatus,
} from '../lib/commercial-staging';

const PAID_STATUSES = new Set<CommercialPublicOrderStatus['status']>([
  'PAYMENT_RECEIVED', 'LICENCE_PREPARING', 'LICENCE_READY', 'LICENCE_SENT',
]);

function safeStatusCopy(status: CommercialPublicOrderStatus['status']): [string, string] {
  switch (status) {
    case 'PAYMENT_RECEIVED': return ['Payment received', 'Your PatrolSafe annual licence is being prepared.'];
    case 'LICENCE_PREPARING': return ['Licence being prepared', 'We are preparing your PatrolSafe annual licence.'];
    case 'LICENCE_READY': return ['Licence ready', 'Check your email for your secure licence delivery.'];
    case 'LICENCE_SENT': return ['Licence sent', 'Your licence has been sent. Please check your email.'];
    case 'CHECKOUT_CANCELLED': return ['Checkout cancelled', 'No confirmed payment was found for this checkout.'];
    case 'SUPPORT_REQUIRED': return ['Please contact PatrolSafe Support', 'We need to help you complete this purchase.'];
    case 'AWAITING_PAYMENT': return ['Confirming payment', 'Payment confirmation is still being processed.'];
  }
}

export function CommercialStatusPage(): JSX.Element {
  const { publicOrderId } = useParams();
  const [searchParams] = useSearchParams();
  const checkoutResult = searchParams.get('checkout');
  const [order, setOrder] = useState<CommercialPublicOrderStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!commercialStagingEnabled() || !publicOrderId || !PUBLIC_ORDER_PATTERN.test(publicOrderId)) {
      setMessage('This purchase status link is invalid.');
      return;
    }
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const load = async (): Promise<void> => {
      attempts += 1;
      try {
        const result = await getCommercialOrderStatus(publicOrderId);
        if (!active) return;
        setOrder(result);
        setMessage(null);
        if (checkoutResult === 'success' && result.status === 'AWAITING_PAYMENT' && attempts < 10) {
          retryTimer = setTimeout(() => void load(), 2_000);
        }
      } catch {
        if (active) setMessage('We could not refresh this order right now. Your purchase processing is not affected. Please check your email or contact PatrolSafe Support.');
      }
    };
    void load();
    return () => { active = false; if (retryTimer) clearTimeout(retryTimer); };
  }, [checkoutResult, publicOrderId]);

  return renderCommercialStatus(order, message, checkoutResult);
}

function renderCommercialStatus(
  order: CommercialPublicOrderStatus | null,
  message: string | null,
  checkoutResult: string | null,
): JSX.Element {
  if (message || !order) return <StatusShell>{message || 'Checking your purchase...'}</StatusShell>;
  const paid = order.paymentReceived && PAID_STATUSES.has(order.status);
  const cancelled = checkoutResult === 'cancelled' && !order.paymentReceived;
  const copy = safeStatusCopy(cancelled ? 'CHECKOUT_CANCELLED' : order.status);
  return <LoadedStatus order={order} paid={paid} cancelled={cancelled} copy={copy} />;
}

function StatusShell({ children }: { children: string }): JSX.Element {
  return <main className='commercial-public-shell'><section className='commercial-public-card'><p className='eyebrow'>PatrolSafe by S4</p><h1>Purchase status</h1><div className='banner banner-info' role='status'>{children}</div></section></main>;
}

function LoadedStatus({ order, paid, cancelled, copy }: {
  order: CommercialPublicOrderStatus;
  paid: boolean;
  cancelled: boolean;
  copy: [string, string];
}): JSX.Element {
  const [title, detail] = copy;
  const tone = paid ? 'banner-success' : order.status === 'SUPPORT_REQUIRED' ? 'banner-warning' : 'banner-info';
  return (
    <main className='commercial-public-shell'>
      <section className='commercial-public-card commercial-confirmation-card'>
        <p className='eyebrow'>PatrolSafe by S4</p>
        <h1>{paid ? 'Thank you for your purchase' : title}</h1>
        {paid ? <p className='commercial-lead'>Your payment has been received successfully.</p> : null}
        <div className={`banner ${tone}`} role='status'><strong>{title}</strong><p>{detail}</p></div>
        {paid ? <PaidInstructions /> : null}
        <OrderDetails order={order} cancelled={cancelled} />
        <p className='commercial-close-copy'>You can now close this window.</p>
        <p className='field-hint'>Payment confirmation does not activate PatrolSafe automatically. Activate only the signed licence file supplied through the secure licence email.</p>
      </section>
    </main>
  );
}

function PaidInstructions(): JSX.Element {
  return <>
    <p>We're preparing your PatrolSafe annual licence. Your licence will be sent to the email address provided during checkout, normally within 24 hours.</p>
    <p>Once received, download the licence file and activate it from:</p>
    <p className='commercial-activation-path'>PatrolSafe &gt; Licence &gt; Activate supplied licence</p>
    <p>If you haven't received your licence within 24 hours, or need help with your purchase, please contact PatrolSafe Support.</p>
  </>;
}

function OrderDetails({ order, cancelled }: { order: CommercialPublicOrderStatus; cancelled: boolean }): JSX.Element {
  const payment = order.paymentReceived ? '£299.00 · Paid' : cancelled ? 'Not completed' : 'Pending confirmation';
  return <div className='detail-grid commercial-order-details' aria-label='Order details'>
    <div className='detail-item'><span>Order</span><strong>{order.publicOrderId}</strong></div>
    <div className='detail-item'><span>Product</span><strong>{order.product}</strong></div>
    <div className='detail-item'><span>Payment</span><strong>{payment}</strong></div>
  </div>;
}
