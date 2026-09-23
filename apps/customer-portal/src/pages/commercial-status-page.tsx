import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  commercialStagingEnabled,
  customerStatus,
  inspectCommercialPurchase,
  purchaseSessionKey,
  PUBLIC_ORDER_PATTERN,
} from '../lib/commercial-staging';

export function CommercialStatusPage(): JSX.Element {
  const { publicOrderId } = useParams();
  const [status, setStatus] = useState('Checking purchase status…');

  useEffect(() => {
    if (!commercialStagingEnabled() || !publicOrderId || !PUBLIC_ORDER_PATTERN.test(publicOrderId)) {
      setStatus('This purchase status link is invalid.');
      return;
    }
    const reference = sessionStorage.getItem(purchaseSessionKey(publicOrderId));
    if (!reference) {
      setStatus('Check your licence email or contact PatrolSafe support.');
      return;
    }
    void inspectCommercialPurchase(reference)
      .then((result) => setStatus(customerStatus(result.orderState)))
      .catch(() => setStatus('Purchase status is temporarily unavailable. Check your email or contact support.'));
  }, [publicOrderId]);

  return <main className="commercial-public-shell"><section className="commercial-public-card"><p className="eyebrow">S4 commercial staging</p><h1>PatrolSafe licence status</h1><div className="banner" role="status">{status}</div><p className="field-hint">Payment confirmation never activates PatrolSafe automatically. Import the signed .tglic supplied through the secure licence email.</p></section></main>;
}
