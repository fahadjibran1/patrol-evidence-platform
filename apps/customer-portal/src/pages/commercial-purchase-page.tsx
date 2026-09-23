import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  commercialStagingEnabled,
  createCommercialCheckout,
  inspectCommercialPurchase,
  purchaseSessionKey,
  validateOpaqueReference,
  validateStripeCheckoutUrl,
  type CommercialPurchasePreview,
} from '../lib/commercial-staging';

export function CommercialPurchasePage(): JSX.Element {
  const { reference } = useParams();
  const [purchase, setPurchase] = useState<CommercialPurchasePreview | null>(null);
  const [email, setEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!commercialStagingEnabled()) { setMessage('Commercial staging is disabled.'); return; }
    try {
      const valid = validateOpaqueReference(reference);
      void inspectCommercialPurchase(valid).then(setPurchase).catch(() => setMessage('This purchase link is unavailable or expired.'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'This purchase link is invalid.');
    }
  }, [reference]);

  async function continueToCheckout(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!purchase || !accepted) return;
    setBusy(true);
    setMessage(null);
    try {
      const valid = validateOpaqueReference(reference);
      const result = await createCommercialCheckout({ reference: valid, customerEmail: email, contactName });
      sessionStorage.setItem(purchaseSessionKey(result.publicOrderId), valid);
      window.location.assign(validateStripeCheckoutUrl(result.checkoutUrl));
    } catch {
      setMessage('Secure checkout could not be started. No payment was taken.');
      setBusy(false);
    }
  }

  return (
    <main className="commercial-public-shell">
      <section className="commercial-public-card">
        <p className="eyebrow">S4 commercial staging · no live payment</p>
        <h1>PatrolSafe Annual Licence</h1>
        {message ? <div className="banner" role="alert">{message}</div> : null}
        {purchase ? <>
          <p className="commercial-price">£299 <span>+ VAT where applicable</span></p>
          <ul className="commercial-summary">
            <li>1 Windows workstation</li>
            <li>12-month licence</li>
            <li>Company: <strong>{purchase.companyName}</strong></li>
          </ul>
          <form className="commercial-form" onSubmit={(event) => void continueToCheckout(event)}>
            <label>Contact name<input value={contactName} maxLength={120} onChange={(event) => setContactName(event.target.value)} /></label>
            <label>Email<input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label className="commercial-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>I acknowledge the staged commercial Terms and Privacy information.</span></label>
            <p className="field-hint">Tax treatment, commercial Terms and Privacy wording remain subject to production approval.</p>
            <button className="primary-button" disabled={!accepted || busy}>{busy ? 'Opening secure checkout…' : 'Continue to secure checkout'}</button>
          </form>
        </> : null}
      </section>
    </main>
  );
}
