import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  commercialEnabled,
  commercialProductionEnabled,
  createCommercialCheckout,
  inspectCommercialPurchase,
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
    if (!commercialEnabled()) { setMessage('Commercial purchasing is unavailable.'); return; }
    try {
      const valid = validateOpaqueReference(reference);
      void inspectCommercialPurchase(valid).then(setPurchase).catch(() => setMessage('This purchase link is unavailable or expired.'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'This purchase link is invalid.');
    }
  }, [reference]);

  async function continueToCheckout(event: FormEvent): Promise<void> {
    event.preventDefault();
    const productionLegalLinksMissing = commercialProductionEnabled()
      && (!purchase?.termsUrl || !purchase?.privacyUrl);
    if (!purchase || !accepted || productionLegalLinksMissing) return;
    setBusy(true);
    setMessage(null);
    try {
      const valid = validateOpaqueReference(reference);
      const result = await createCommercialCheckout({
        reference: valid,
        customerEmail: email,
        contactName,
        legalAccepted: true,
        acceptedTermsVersion: purchase.termsVersion,
        acceptedPrivacyVersion: purchase.privacyVersion,
      });
      window.location.assign(validateStripeCheckoutUrl(result.checkoutUrl));
    } catch {
      setMessage('Secure checkout could not be started. No payment was taken.');
      setBusy(false);
    }
  }

  const legalLinksAvailable = Boolean(purchase?.termsUrl && purchase?.privacyUrl);
  const legalAcceptanceAvailable = legalLinksAvailable || !commercialProductionEnabled();
  return (
    <main className="commercial-public-shell">
      <section className="commercial-public-card">
        <p className="eyebrow">PatrolSafe by S4</p>
        <h1>PatrolSafe Annual Licence</h1>
        {message ? <div className="banner" role="alert">{message}</div> : null}
        {purchase ? <>
          <p className="commercial-price">&pound;299 <span>including VAT</span></p>
          <ul className="commercial-summary">
            <li>One Windows workstation</li>
            <li>12-month licence</li>
            <li>One-off payment with no automatic renewal</li>
            <li>UK business customers only</li>
            <li>Company: <strong>{purchase.companyName}</strong></li>
          </ul>
          <p>Your licence will be prepared after payment and sent to the email address supplied below. Secure download links expire after 24 hours; {purchase.supportUrl ? <a href={purchase.supportUrl} target="_blank" rel="noreferrer">PatrolSafe Support</a> : 'PatrolSafe Support'} can send a fresh link for the same licence if needed.</p>
          <form className="commercial-form" onSubmit={(event) => void continueToCheckout(event)}>
            <label>Contact name<input value={contactName} maxLength={120} onChange={(event) => setContactName(event.target.value)} /></label>
            <label>Email<input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            {legalLinksAvailable ? (
              <label className="commercial-check">
                <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
                <span>I accept the <a href={purchase.termsUrl!} target="_blank" rel="noreferrer">PatrolSafe Terms</a> and acknowledge the <a href={purchase.privacyUrl!} target="_blank" rel="noreferrer">Privacy Notice</a>.</span>
              </label>
            ) : legalAcceptanceAvailable ? (
              <label className="commercial-check">
                <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
                <span>I accept the applicable PatrolSafe Terms and acknowledge the Privacy Notice.</span>
              </label>
            ) : <div className="banner" role="alert">Secure checkout is temporarily unavailable because the legal documents cannot be displayed.</div>}
            <p className="field-hint">&pound;299 total, including VAT. Payment is taken once for a 12-month licence; there is no automatic renewal.</p>
            <button className="primary-button" disabled={!accepted || !legalAcceptanceAvailable || busy}>{busy ? 'Opening secure checkout...' : 'Continue to secure checkout'}</button>
          </form>
        </> : null}
      </section>
    </main>
  );
}
