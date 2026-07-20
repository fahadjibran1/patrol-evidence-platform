import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest, copyToClipboard, downloadTextFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDaysIso, formatUkDate, toIsoDate, todayIsoDate } from '../lib/dates';
import {
  ButtonRow,
  Card,
  ErrorBanner,
  Field,
  InfoBanner,
  PageHeader,
  WarningBanner,
} from '../components/ui';
import type {
  CustomerSummary,
  IssueLicenceRequest,
  IssueLicenceResponse,
  LicensePlan,
  PaginatedResponse,
  PaymentStatus,
} from '../types';

const plans: LicensePlan[] = ['TRIAL', 'MONTHLY', 'ANNUAL'];

export function IssueLicencePage(): JSX.Element {
  const { accessToken } = useAuth();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [plan, setPlan] = useState<LicensePlan>('ANNUAL');
  const [startsAt, setStartsAt] = useState(todayIsoDate());
  const [expiresAt, setExpiresAt] = useState(addDaysIso(todayIsoDate(), 365));
  const [maxDevices, setMaxDevices] = useState(3);
  const [features, setFeatures] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('PENDING');
  const [paymentReference, setPaymentReference] = useState('');
  const [step, setStep] = useState<'form' | 'confirm' | 'issued'>('form');
  const [issueResult, setIssueResult] = useState<IssueLicenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    void apiRequest<PaginatedResponse<CustomerSummary>>('/admin/customers?page=1&pageSize=200', {}, accessToken)
      .then((response) => {
        setCustomers(response.items);
        if (response.items[0]) {
          setCustomerId(response.items[0].id);
          setCustomerEmail(response.items[0].email);
        }
      })
      .catch(() => {
        setCustomers([]);
      });
  }, [accessToken]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === customerId) ?? null,
    [customerId, customers],
  );

  function buildRequest(): IssueLicenceRequest {
    return {
      customerId,
      plan,
      startsAt,
      expiresAt,
      maxDevices,
      features: features
        .split(',')
        .map((feature) => feature.trim())
        .filter(Boolean),
      customerEmail: customerEmail.trim() || undefined,
      notes: notes.trim() || undefined,
      paymentStatus,
      paymentReference: paymentReference.trim() || undefined,
    };
  }

  function handleReview(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);

    try {
      if (startsAt > expiresAt) {
        throw new Error('Expiry date must be on or after the start date.');
      }

      setStep('confirm');
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Validation failed');
    }
  }

  async function handleIssue(): Promise<void> {
    if (!accessToken) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await apiRequest<IssueLicenceResponse>('/admin/licences/issue', {
        method: 'POST',
        body: JSON.stringify(buildRequest()),
      }, accessToken);
      setIssueResult(response);
      setStep('issued');
    } catch (submissionError) {
      setError(submissionError instanceof ApiError ? submissionError.message : 'Issue failed');
      setStep('form');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step === 'issued' && issueResult) {
    const fileName = `${issueResult.licence.licenseId}.txt`;

    return (
      <div className="page-stack">
        <PageHeader
          title="Licence issued"
          subtitle={`${issueResult.licence.licenseId} for ${selectedCustomer?.companyName ?? 'customer'}`}
        />

        <InfoBanner
          title="Transmit securely"
          message="This is the only time the full TG1 key is shown in list views. Copy or download it now and send it through a secure channel."
        />

        <Card>
          <div className="detail-grid">
            <div className="detail-item"><span>Licence ID</span><strong>{issueResult.licence.licenseId}</strong></div>
            <div className="detail-item"><span>Company</span><strong>{selectedCustomer?.companyName ?? issueResult.licence.payloadSummary?.companyName}</strong></div>
            <div className="detail-item"><span>Plan</span><strong>{issueResult.licence.plan}</strong></div>
            <div className="detail-item"><span>Starts</span><strong>{formatUkDate(issueResult.licence.startsAt)}</strong></div>
            <div className="detail-item"><span>Expires</span><strong>{formatUkDate(issueResult.licence.expiresAt)}</strong></div>
          </div>

          <p className="key-display" aria-label="Issued TG1 licence key">{issueResult.licenseKey}</p>

          <ButtonRow>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void copyToClipboard(issueResult.licenseKey).then(() => setCopyMessage('Licence key copied.'));
              }}
            >
              Copy key
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => downloadTextFile(fileName, issueResult.licenseKey)}
            >
              Download .txt
            </button>
            <Link to={`/licences/${issueResult.licence.id}`} className="secondary-button">View licence</Link>
          </ButtonRow>
          {copyMessage ? <p className="success-text">{copyMessage}</p> : null}
        </Card>
      </div>
    );
  }

  if (step === 'confirm') {
    const request = buildRequest();

    return (
      <div className="page-stack">
        <PageHeader title="Confirm licence issue" subtitle="Review the summary before signing the TG1 payload." />

        <Card>
          <div className="detail-grid">
            <div className="detail-item"><span>Customer</span><strong>{selectedCustomer?.companyName ?? request.customerId}</strong></div>
            <div className="detail-item"><span>Plan</span><strong>{request.plan}</strong></div>
            <div className="detail-item"><span>Start date</span><strong>{formatUkDate(request.startsAt)}</strong></div>
            <div className="detail-item"><span>Expiry date</span><strong>{formatUkDate(request.expiresAt)}</strong></div>
            <div className="detail-item"><span>Max devices</span><strong>{request.maxDevices}</strong></div>
            <div className="detail-item"><span>Payment status</span><strong>{request.paymentStatus ?? 'PENDING'}</strong></div>
          </div>

          <WarningBanner
            title="Signing happens on the server"
            message="The private signing key never leaves the licence API. The portal will receive the signed TG1 key once issuance succeeds."
          />

          {error ? <ErrorBanner message={error} /> : null}

          <ButtonRow>
            <button type="button" className="secondary-button" onClick={() => setStep('form')}>Back</button>
            <button type="button" className="primary-button" disabled={isSubmitting} onClick={() => void handleIssue()}>
              {isSubmitting ? 'Issuing…' : 'Issue licence'}
            </button>
          </ButtonRow>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader title="Issue licence" subtitle="Create and sign a new TG1 licence for a customer." />

      <form className="page-stack" onSubmit={handleReview}>
        <Card>
          <div className="two-column-grid">
            <Field label="Customer">
              <select value={customerId} onChange={(event) => {
                const nextId = event.target.value;
                setCustomerId(nextId);
                const nextCustomer = customers.find((customer) => customer.id === nextId);
                if (nextCustomer) {
                  setCustomerEmail(nextCustomer.email);
                }
              }} required>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.companyName}</option>
                ))}
              </select>
            </Field>

            <Field label="Plan">
              <select value={plan} onChange={(event) => setPlan(event.target.value as LicensePlan)}>
                {plans.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </Field>

            <Field label="Start date (DD/MM/YYYY)">
              <input
                defaultValue={formatUkDate(startsAt)}
                onBlur={(event) => {
                  try {
                    setStartsAt(toIsoDate(event.target.value));
                  } catch (validationError) {
                    setError(validationError instanceof Error ? validationError.message : 'Invalid start date');
                  }
                }}
                placeholder="DD/MM/YYYY"
                required
              />
            </Field>

            <Field label="Expiry date (DD/MM/YYYY)">
              <input
                defaultValue={formatUkDate(expiresAt)}
                onBlur={(event) => {
                  try {
                    setExpiresAt(toIsoDate(event.target.value));
                  } catch (validationError) {
                    setError(validationError instanceof Error ? validationError.message : 'Invalid expiry date');
                  }
                }}
                placeholder="DD/MM/YYYY"
                required
              />
            </Field>

            <Field label="Maximum devices">
              <input type="number" min={1} value={maxDevices} onChange={(event) => setMaxDevices(Number(event.target.value))} required />
            </Field>

            <Field label="Customer email">
              <input type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} />
            </Field>

            <Field label="Features (comma-separated)">
              <input value={features} onChange={(event) => setFeatures(event.target.value)} placeholder="evidence, patrol-ops" />
            </Field>

            <Field label="Payment status">
              <select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)}>
                <option value="PENDING">PENDING</option>
                <option value="PAID">PAID</option>
                <option value="WAIVED">WAIVED</option>
              </select>
            </Field>

            <Field label="Payment reference">
              <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} />
            </Field>
          </div>

          <Field label="Notes">
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </Card>

        {error ? <ErrorBanner message={error} /> : null}

        <ButtonRow>
          <Link to="/licences" className="secondary-button">Cancel</Link>
          <button type="submit" className="primary-button">Review and confirm</button>
        </ButtonRow>
      </form>
    </div>
  );
}
