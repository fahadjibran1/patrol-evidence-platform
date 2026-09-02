import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canManageBilling } from '../lib/roles';
import {
  Card,
  ErrorBanner,
  Field,
  InfoBanner,
  PageHeader,
} from '../components/ui';
import type { BillingPayment, ManualPaymentMethod, RecordManualPaymentRequest } from '../types';

const PAYMENT_METHODS: ManualPaymentMethod[] = [
  'CASH',
  'BANK_TRANSFER',
  'CARD',
  'CHEQUE',
  'OTHER',
];

function formatApiError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function BillingManualPaymentPage(): JSX.Element {
  const { accessToken, admin } = useAuth();
  const canRecord = canManageBilling(admin?.role);
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ManualPaymentMethod>('BANK_TRANSFER');
  const [providerReference, setProviderReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!canRecord) {
    return (
      <div className="page-stack">
        <PageHeader title="Record manual payment" subtitle="Post a payment against an invoice." />
        <InfoBanner
          title="Read-only access"
          message="Manual payment recording requires ADMIN or SUPER_ADMIN."
        />
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    const amountPence = Number.parseInt(amount.trim(), 10);
    if (!Number.isFinite(amountPence) || amountPence < 1) {
      setError('Enter a valid amount in pence (minor units).');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    const body: RecordManualPaymentRequest = {
      invoiceId: invoiceId.trim(),
      amount: amountPence,
      method,
      providerReference: providerReference.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    try {
      const payment = await apiRequest<BillingPayment>(
        '/admin/billing/payments/manual',
        { method: 'POST', body: JSON.stringify(body) },
        accessToken,
      );
      setInvoiceId('');
      setAmount('');
      setProviderReference('');
      setNotes('');
      setSuccess(
        `Recorded ${payment.amount} ${payment.currency} against invoice ${payment.invoiceNumber ?? payment.invoiceId}.`,
      );
    } catch (submissionError) {
      setError(formatApiError(submissionError, 'Failed to record payment'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Record manual payment"
        subtitle="Post a payment against an open invoice. Amounts are in pence."
        actions={
          <Link to="/billing/payments" className="secondary-button">
            Back to payments
          </Link>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {success ? (
        <div className="banner banner-info" role="status">
          <strong>Success</strong>
          <p>{success}</p>
        </div>
      ) : null}

      <Card>
        <form className="two-column-grid" onSubmit={(event) => void handleSubmit(event)}>
          <Field label="Invoice ID" hint="UUID of the invoice being paid.">
            <input
              value={invoiceId}
              onChange={(event) => setInvoiceId(event.target.value)}
              placeholder="Invoice UUID"
              required
            />
          </Field>
          <Field label="Amount (pence)" hint="Minor currency units, e.g. 9900 for £99.00.">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="numeric"
              placeholder="9900"
              required
            />
          </Field>
          <Field label="Method">
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as ManualPaymentMethod)}
            >
              {PAYMENT_METHODS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Provider reference">
            <input
              value={providerReference}
              onChange={(event) => setProviderReference(event.target.value)}
              placeholder="Bank reference, cheque number, etc."
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
            />
          </Field>
          <div className="field">
            <span>&nbsp;</span>
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Recording…' : 'Record payment'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
