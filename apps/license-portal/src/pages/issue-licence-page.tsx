import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest, copyToClipboard } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney, formatUkDate, toIsoDate } from '../lib/dates';
import {
  buildActivationInstructions,
  buildLicenceFilename,
  downloadLicenceFile,
} from '../lib/licence-file';
import {
  clearIssueWizardDraft,
  createInitialIssueWizardDraft,
  isCustomerSelectable,
  readIssueWizardDraft,
  writeIssueWizardDraft,
  type IssueWizardDraft,
} from '../lib/issue-wizard-state';
import {
  defaultFeaturesForPlan,
  LICENCE_FEATURE_CATALOG,
  REQUIRED_LICENCE_FEATURES,
  SUPPORTED_LICENCE_FEATURES,
  toggleFeature,
} from '../lib/licence-features';
import { penceToPoundsInput, poundsToPence } from '../lib/money';
import { computeExpiresAtIso, PLAN_DESCRIPTIONS } from '../lib/plan-dates';
import { canIssueLicences } from '../lib/roles';
import { WizardStepper } from '../components/wizard-stepper';
import { EmailLicenceModal } from '../components/email-licence-modal';
import {
  ButtonRow,
  Card,
  ErrorBanner,
  Field,
  InfoBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
  WarningBanner,
} from '../components/ui';
import type {
  CreateCustomerRequest,
  CustomerSummary,
  IssueLicenceRequest,
  IssueLicenceResponse,
  LicensePlan,
  PaginatedResponse,
  PaymentStatus,
  SigningKeyStatus,
} from '../types';

const PLANS: LicensePlan[] = ['TRIAL', 'MONTHLY', 'ANNUAL'];
const MAX_DEVICES = 100;

function formatError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.code && !error.message.startsWith(`${error.code}:`)
      ? `${error.code}: ${error.message}`
      : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function maskTg1Preview(key: string): string {
  if (key.length < 24) {
    return 'TG1.…';
  }
  return `${key.slice(0, 12)}…${key.slice(-8)}`;
}

export function IssueLicencePage(): JSX.Element {
  const { accessToken, admin } = useAuth();
  const canIssue = canIssueLicences(admin?.role);

  const [draft, setDraft] = useState<IssueWizardDraft>(() => readIssueWizardDraft() ?? createInitialIssueWizardDraft());
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [amountInput, setAmountInput] = useState(() => penceToPoundsInput((readIssueWizardDraft() ?? createInitialIssueWizardDraft()).amountPence));
  const [signingStatus, setSigningStatus] = useState<SigningKeyStatus | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [issueResult, setIssueResult] = useState<IssueLicenceResponse | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const submittingRef = useRef(false);

  function patchDraft(patch: Partial<IssueWizardDraft>): void {
    setDraft((current) => {
      const next = { ...current, ...patch };
      writeIssueWizardDraft(next);
      return next;
    });
  }

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    setCustomersLoading(true);
    setCustomersError(null);
    void apiRequest<PaginatedResponse<CustomerSummary>>('/admin/customers?page=1&pageSize=100', {}, accessToken)
      .then((response) => setCustomers(response.items ?? []))
      .catch((error) => setCustomersError(formatError(error, 'Failed to load customers')))
      .finally(() => setCustomersLoading(false));

    void apiRequest<SigningKeyStatus>('/admin/settings/signing-key', {}, accessToken)
      .then(setSigningStatus)
      .catch(() => setSigningStatus(null));
  }, [accessToken]);

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    return customers.filter((customer) => {
      if (!term) {
        return true;
      }
      return (
        customer.companyName.toLowerCase().includes(term) ||
        (customer.contactName ?? '').toLowerCase().includes(term) ||
        customer.email.toLowerCase().includes(term)
      );
    });
  }, [customerSearch, customers]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === draft.customerId) ?? draft.customerSnapshot,
    [customers, draft.customerId, draft.customerSnapshot],
  );

  function goTo(step: IssueWizardDraft['step']): void {
    setStepError(null);
    patchDraft({ step });
  }

  function validateCustomer(): boolean {
    if (!draft.customerId || !selectedCustomer) {
      setStepError('Select a customer before continuing.');
      return false;
    }
    if (selectedCustomer.status === 'CLOSED') {
      setStepError('CLOSED customers cannot receive a new licence.');
      return false;
    }
    if (selectedCustomer.status === 'SUSPENDED') {
      setStepError('SUSPENDED customers cannot receive a new licence.');
      return false;
    }
    if (!isCustomerSelectable(selectedCustomer.status)) {
      setStepError('Selected customer is not eligible for issuance.');
      return false;
    }
    return true;
  }

  function validatePlan(): boolean {
    if (!draft.plan) {
      setStepError('Select a plan.');
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startsAt)) {
      setStepError('Start date is invalid.');
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.expiresAt)) {
      setStepError('Expiry date is invalid.');
      return false;
    }
    if (draft.startsAt > draft.expiresAt) {
      setStepError('Expiry date must be on or after the start date.');
      return false;
    }
    return true;
  }

  function validateDevices(): boolean {
    if (!Number.isInteger(draft.maxDevices) || draft.maxDevices < 1 || draft.maxDevices > MAX_DEVICES) {
      setStepError(`Maximum devices must be an integer between 1 and ${MAX_DEVICES}.`);
      return false;
    }
    for (const required of REQUIRED_LICENCE_FEATURES) {
      if (!draft.features.includes(required)) {
        setStepError(`Feature "${required}" is required.`);
        return false;
      }
    }
    const unsupported = draft.features.filter((feature) => !(SUPPORTED_LICENCE_FEATURES as readonly string[]).includes(feature as never));
    if (unsupported.length > 0) {
      setStepError(`Unsupported features: ${unsupported.join(', ')}`);
      return false;
    }
    return true;
  }

  function validatePayment(): boolean {
    try {
      const pence = poundsToPence(amountInput);
      if (pence < 0) {
        setStepError('Amount cannot be negative.');
        return false;
      }
      patchDraft({ amountPence: pence });
    } catch (error) {
      setStepError(error instanceof Error ? error.message : 'Invalid payment amount');
      return false;
    }

    if (draft.paymentStatus === 'PAID' && !draft.paymentReference.trim()) {
      setStepError('Payment reference is required when status is PAID.');
      return false;
    }
    return true;
  }

  async function handleIssue(): Promise<void> {
    if (!accessToken || !canIssue || submittingRef.current) {
      return;
    }
    if (!draft.confirmed) {
      setStepError('Confirm that you have reviewed all details before issuing.');
      return;
    }
    if (!validateCustomer() || !validatePlan() || !validateDevices() || !validatePayment()) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setStepError(null);

    const body: IssueLicenceRequest = {
      customerId: draft.customerId,
      plan: draft.plan,
      startsAt: draft.startsAt,
      expiresAt: draft.expiresAt,
      maxDevices: draft.maxDevices,
      features: Array.from(new Set(draft.features)),
      customerEmail: draft.customerEmail.trim() || undefined,
      notes: draft.notes.trim() || undefined,
      paymentStatus: draft.paymentStatus,
      amountPence: draft.amountPence,
      paymentMethod: draft.paymentMethod.trim() || undefined,
      paymentReference: draft.paymentReference.trim() || undefined,
      invoiceReference: draft.invoiceReference.trim() || undefined,
    };

    try {
      const response = await apiRequest<IssueLicenceResponse & { fullLicenseKey?: string; signedLicenseKey?: string }>(
        '/admin/licences/issue',
        { method: 'POST', body: JSON.stringify(body) },
        accessToken,
      );

      const fullKey = response.fullLicenseKey ?? response.licenseKey ?? response.signedLicenseKey;
      if (!fullKey || !response.licence) {
        // Support flat legacy responses
        const flat = response as unknown as { id?: string; licenseId?: string; signedLicenseKey?: string };
        if (flat.signedLicenseKey && flat.id) {
          setIssueResult({
            licence: response.licence ?? (response as unknown as IssueLicenceResponse['licence']),
            licenseKey: flat.signedLicenseKey,
            fullLicenseKey: flat.signedLicenseKey,
          });
        } else {
          throw new Error('Issue response was missing licence or TG1 key');
        }
      } else {
        setIssueResult({
          licence: response.licence,
          licenseKey: fullKey,
          fullLicenseKey: fullKey,
        });
      }

      clearIssueWizardDraft();
      setDraft(createInitialIssueWizardDraft());
      setAmountInput('0.00');
    } catch (error) {
      setStepError(formatError(error, 'Licence issuance failed'));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  if (!canIssue) {
    return (
      <div className="page-stack">
        <PageHeader title="Issue licence" subtitle="Issuance is restricted to ADMIN and SUPER_ADMIN roles." />
        <ErrorBanner message="SUPPORT users cannot issue licences or view newly signed TG1 keys." />
        <Link to="/licences" className="secondary-button">Return to licences</Link>
      </div>
    );
  }

  if (issueResult) {
    const key = issueResult.fullLicenseKey ?? issueResult.licenseKey;
    const hasFullKey = Boolean(key?.startsWith('TG1.'));

    return (
      <div className="page-stack">
        <PageHeader
          title="Licence issued"
          subtitle={`${issueResult.licence.licenseId} signed successfully`}
        />
        <InfoBanner
          title="Transmit securely"
          message="This full licence key may not be shown again without an authorised reveal. Do not put the key in URLs or browser storage."
        />
        <WarningBanner
          title="Store this file securely"
          message="It contains the full commercial licence key."
        />
        <Card>
          <div className="detail-grid">
            <div className="detail-item"><span>Licence ID</span><strong>{issueResult.licence.licenseId}</strong></div>
            <div className="detail-item"><span>Customer</span><strong>{selectedCustomer?.companyName ?? '—'}</strong></div>
            <div className="detail-item"><span>Plan</span><strong>{issueResult.licence.plan}</strong></div>
            <div className="detail-item"><span>Starts</span><strong>{formatUkDate(issueResult.licence.startsAt)}</strong></div>
            <div className="detail-item"><span>Expires</span><strong>{formatUkDate(issueResult.licence.expiresAt)}</strong></div>
            <div className="detail-item"><span>Max devices</span><strong>{issueResult.licence.maxDevices}</strong></div>
            <div className="detail-item"><span>Signing key ID</span><strong>{issueResult.licence.signingKeyId ?? signingStatus?.keyId ?? '—'}</strong></div>
            <div className="detail-item"><span>TG1 preview</span><strong>{hasFullKey ? maskTg1Preview(key) : 'Unavailable'}</strong></div>
          </div>

          <WarningBanner
            title="Protected TG1 key"
            message="Copy or download the key now. It is held only in this success screen memory."
          />
          {hasFullKey ? <p className="key-display" aria-label="Issued TG1 licence key">{key}</p> : null}

          <ButtonRow>
            <button
              type="button"
              className="primary-button"
              disabled={!hasFullKey}
              onClick={() => {
                if (!hasFullKey || !accessToken) {
                  return;
                }
                const result = downloadLicenceFile(issueResult.licence.licenseId, key);
                setCopyMessage(`${result.fileName} downloaded.`);
                void apiRequest(
                  `/admin/licences/${issueResult.licence.id}/download-event`,
                  {
                    method: 'POST',
                    body: JSON.stringify({ source: 'issue-success' }),
                  },
                  accessToken,
                ).catch(() => undefined);
              }}
            >
              Download licence file
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!hasFullKey}
              onClick={() => setShowEmailModal(true)}
            >
              Email licence
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!hasFullKey}
              onClick={() => {
                if (!hasFullKey) {
                  return;
                }
                void copyToClipboard(key).then(() => setCopyMessage('TG1 key copied.'));
              }}
            >
              Copy full TG1 key
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void copyToClipboard(issueResult.licence.licenseId).then(() => setCopyMessage('Licence ID copied.'));
              }}
            >
              Copy licence ID
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void copyToClipboard(
                  buildActivationInstructions({
                    licenseId: issueResult.licence.licenseId,
                    companyName: selectedCustomer?.companyName ?? 'Customer',
                    plan: issueResult.licence.plan,
                    expiresAtDisplay: formatUkDate(issueResult.licence.expiresAt),
                  }),
                ).then(() => setCopyMessage('Activation instructions copied.'));
              }}
            >
              Copy activation instructions
            </button>
            <Link to={`/licences/${issueResult.licence.id}`} className="secondary-button">Go to licence detail</Link>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setIssueResult(null);
                setCopyMessage(null);
                setDraft(createInitialIssueWizardDraft());
                clearIssueWizardDraft();
              }}
            >
              Issue another licence
            </button>
            <Link to={`/customers/${issueResult.licence.customerId}`} className="secondary-button">Return to customer</Link>
          </ButtonRow>
          {copyMessage ? <p className="success-text">{copyMessage}</p> : null}
        </Card>
        {showEmailModal && accessToken && hasFullKey ? (
          <EmailLicenceModal
            licenceId={issueResult.licence.id}
            humanLicenseId={issueResult.licence.licenseId}
            defaultRecipient={selectedCustomer?.email ?? issueResult.licence.customerEmail ?? ''}
            defaultSubject={`Your PatrolSafe Licence – ${issueResult.licence.licenseId}`}
            accessToken={accessToken}
            source="issue-success"
            fullLicenseKey={key}
            requirePassword={false}
            onClose={() => setShowEmailModal(false)}
            onSent={(result) => {
              setCopyMessage(`Licence emailed successfully to ${result.recipient}.`);
            }}
            onDownloadInstead={() => {
              if (!hasFullKey || !key) {
                return;
              }
              downloadLicenceFile(issueResult.licence.licenseId, key);
              void apiRequest(
                `/admin/licences/${issueResult.licence.id}/download-event`,
                {
                  method: 'POST',
                  body: JSON.stringify({ source: 'issue-success' }),
                },
                accessToken,
              ).catch(() => undefined);
              setCopyMessage(`${buildLicenceFilename(issueResult.licence.licenseId)} downloaded.`);
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Issue licence"
        subtitle="Guided wizard to create and sign a commercial TG1 licence."
      />
      <WizardStepper current={draft.step} />
      {stepError ? <ErrorBanner message={stepError} /> : null}

      {draft.step === 'customer' ? (
        <Card>
          <div className="search-row">
            <Field label="Search customers">
              <input
                id="issue-customer-search"
                name="customerSearch"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Company, contact or email"
                autoComplete="off"
              />
            </Field>
            <button type="button" className="secondary-button" onClick={() => setShowCreateCustomer(true)}>
              Create new customer
            </button>
          </div>

          {customersError ? <ErrorBanner message={customersError} /> : null}
          {customersLoading ? <LoadingState label="Loading customers…" /> : null}
          {!customersLoading && !customersError && filteredCustomers.length === 0 ? (
            <InfoBanner title="No customers found" message="Try another search or create a new customer." />
          ) : null}

          <div className="customer-picker" role="listbox" aria-label="Customers">
            {filteredCustomers.map((customer) => {
              const selectable = isCustomerSelectable(customer.status);
              const selected = draft.customerId === customer.id;
              return (
                <button
                  key={customer.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`customer-option ${selected ? 'selected' : ''} ${selectable ? '' : 'disabled'}`}
                  disabled={!selectable}
                  onClick={() => {
                    patchDraft({
                      customerId: customer.id,
                      customerEmail: customer.email,
                      customerSnapshot: {
                        id: customer.id,
                        companyName: customer.companyName,
                        contactName: customer.contactName,
                        email: customer.email,
                        status: customer.status,
                      },
                    });
                    setStepError(null);
                  }}
                >
                  <strong>{customer.companyName}</strong>
                  <span>{customer.contactName ?? 'No contact name'}</span>
                  <span>{customer.email}</span>
                  <StatusBadge value={customer.status} />
                  {customer.status === 'SUSPENDED' ? <span className="field-hint">Suspended — issuance blocked</span> : null}
                  {customer.status === 'CLOSED' ? <span className="field-hint">Closed — not selectable</span> : null}
                </button>
              );
            })}
          </div>

          <Field label="Billing email">
            <input
              id="issue-customer-email"
              name="customerEmail"
              type="email"
              autoComplete="email"
              value={draft.customerEmail}
              onChange={(event) => patchDraft({ customerEmail: event.target.value })}
            />
          </Field>

          <ButtonRow>
            <Link to="/licences" className="secondary-button">Cancel</Link>
            <button
              type="button"
              className="primary-button"
              disabled={customersLoading || Boolean(customersError)}
              onClick={() => {
                if (validateCustomer()) {
                  goTo('plan');
                }
              }}
            >
              Continue
            </button>
          </ButtonRow>
        </Card>
      ) : null}

      {draft.step === 'plan' ? (
        <Card>
          <div className="plan-cards">
            {PLANS.map((plan) => (
              <button
                key={plan}
                type="button"
                className={`plan-card ${draft.plan === plan ? 'selected' : ''}`}
                onClick={() => {
                  const expiresAt = draft.expiryOverridden
                    ? draft.expiresAt
                    : computeExpiresAtIso(draft.startsAt, plan);
                  patchDraft({
                    plan,
                    expiresAt,
                    features: defaultFeaturesForPlan(plan),
                  });
                }}
              >
                <strong>{plan}</strong>
                <p>{PLAN_DESCRIPTIONS[plan]}</p>
              </button>
            ))}
          </div>

          <div className="two-column-grid">
            <Field label="Start date (DD/MM/YYYY)" hint="Defaults to today in Europe/London.">
              <input
                id="issue-starts-at"
                name="startsAt"
                defaultValue={formatUkDate(draft.startsAt)}
                onBlur={(event) => {
                  try {
                    const startsAt = toIsoDate(event.target.value);
                    patchDraft({
                      startsAt,
                      expiresAt: draft.expiryOverridden ? draft.expiresAt : computeExpiresAtIso(startsAt, draft.plan),
                    });
                    setStepError(null);
                  } catch (error) {
                    setStepError(error instanceof Error ? error.message : 'Invalid start date');
                  }
                }}
              />
            </Field>
            <Field label="Expiry date (DD/MM/YYYY)" hint="Licence remains valid through the full UTC day of expiresAt.">
              <input
                id="issue-expires-at"
                name="expiresAt"
                defaultValue={formatUkDate(draft.expiresAt)}
                key={draft.expiresAt}
                onBlur={(event) => {
                  try {
                    const expiresAt = toIsoDate(event.target.value);
                    patchDraft({ expiresAt, expiryOverridden: true });
                    setStepError(null);
                  } catch (error) {
                    setStepError(error instanceof Error ? error.message : 'Invalid expiry date');
                  }
                }}
              />
            </Field>
          </div>

          <ButtonRow>
            <button type="button" className="secondary-button" onClick={() => goTo('customer')}>Back</button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const expiresAt = computeExpiresAtIso(draft.startsAt, draft.plan);
                patchDraft({ expiresAt, expiryOverridden: false });
              }}
            >
              Reset expiry to plan default
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (validatePlan()) {
                  goTo('devices');
                }
              }}
            >
              Continue
            </button>
          </ButtonRow>
        </Card>
      ) : null}

      {draft.step === 'devices' ? (
        <Card>
          <InfoBanner
            title="Administrative device limit"
            message="Phase 2 records max devices on the signed licence. Online enforcement arrives in Phase 3."
          />
          <Field label="Maximum devices">
            <input
              id="issue-max-devices"
              name="maxDevices"
              type="number"
              min={1}
              max={MAX_DEVICES}
              step={1}
              value={draft.maxDevices}
              onChange={(event) => patchDraft({ maxDevices: Number(event.target.value) })}
            />
          </Field>

          <div className="feature-toolbar">
            <button
              type="button"
              className="secondary-button"
              onClick={() => patchDraft({ features: [...SUPPORTED_LICENCE_FEATURES] })}
            >
              Select all
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => patchDraft({ features: [...REQUIRED_LICENCE_FEATURES] })}
            >
              Clear all
            </button>
          </div>

          <div className="feature-grid">
            {LICENCE_FEATURE_CATALOG.map((feature) => {
              const checked = draft.features.includes(feature.id);
              return (
                <label key={feature.id} className="feature-option" htmlFor={`feature-${feature.id}`}>
                  <input
                    id={`feature-${feature.id}`}
                    name={`feature-${feature.id}`}
                    type="checkbox"
                    checked={checked}
                    disabled={feature.required}
                    onChange={(event) => patchDraft({ features: toggleFeature(draft.features, feature.id, event.target.checked) })}
                  />
                  <span>
                    <strong>{feature.label}</strong>
                    <span className="field-hint">{feature.description}</span>
                    <code className="feature-id">{feature.id}</code>
                  </span>
                </label>
              );
            })}
          </div>

          <ButtonRow>
            <button type="button" className="secondary-button" onClick={() => goTo('plan')}>Back</button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (validateDevices()) {
                  goTo('payment');
                }
              }}
            >
              Continue
            </button>
          </ButtonRow>
        </Card>
      ) : null}

      {draft.step === 'payment' ? (
        <Card>
          <div className="two-column-grid">
            <Field label="Payment status">
              <select
                id="issue-payment-status"
                name="paymentStatus"
                value={draft.paymentStatus}
                onChange={(event) => patchDraft({ paymentStatus: event.target.value as PaymentStatus })}
              >
                <option value="PENDING">PENDING</option>
                <option value="PAID">PAID</option>
                <option value="WAIVED">WAIVED</option>
              </select>
            </Field>
            <Field label="Amount (GBP)">
              <input
                id="issue-amount"
                name="amountGbp"
                inputMode="decimal"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                onBlur={() => {
                  try {
                    const pence = poundsToPence(amountInput);
                    setAmountInput(penceToPoundsInput(pence));
                    patchDraft({ amountPence: pence });
                  } catch {
                    // validated on continue
                  }
                }}
              />
            </Field>
            <Field label="Payment method">
              <input
                id="issue-payment-method"
                name="paymentMethod"
                value={draft.paymentMethod}
                onChange={(event) => patchDraft({ paymentMethod: event.target.value })}
                placeholder="Bank transfer, card, invoice…"
                autoComplete="off"
              />
            </Field>
            <Field label="Payment reference" hint={draft.paymentStatus === 'PAID' ? 'Required for PAID' : 'Optional'}>
              <input
                id="issue-payment-reference"
                name="paymentReference"
                value={draft.paymentReference}
                onChange={(event) => patchDraft({ paymentReference: event.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field label="Invoice reference">
              <input
                id="issue-invoice-reference"
                name="invoiceReference"
                value={draft.invoiceReference}
                onChange={(event) => patchDraft({ invoiceReference: event.target.value })}
                autoComplete="off"
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              id="issue-notes"
              name="notes"
              value={draft.notes}
              onChange={(event) => patchDraft({ notes: event.target.value })}
            />
          </Field>
          <p className="muted-text">Payment summary: {formatMoney(draft.amountPence)} GBP · {draft.paymentStatus}</p>
          <InfoBanner
            title="PENDING is allowed"
            message="Licences may be issued with PENDING payment status. The payment record is created with the signed licence."
          />
          <ButtonRow>
            <button type="button" className="secondary-button" onClick={() => goTo('devices')}>Back</button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (validatePayment()) {
                  goTo('review');
                }
              }}
            >
              Continue
            </button>
          </ButtonRow>
        </Card>
      ) : null}

      {draft.step === 'review' ? (
        <Card>
          <div className="detail-grid">
            <div className="detail-item"><span>Company</span><strong>{selectedCustomer?.companyName ?? '—'}</strong></div>
            <div className="detail-item"><span>Contact</span><strong>{selectedCustomer?.contactName ?? '—'}</strong></div>
            <div className="detail-item"><span>Email</span><strong>{draft.customerEmail || selectedCustomer?.email || '—'}</strong></div>
            <div className="detail-item"><span>Status</span><strong><StatusBadge value={selectedCustomer?.status ?? 'UNKNOWN'} /></strong></div>
            <div className="detail-item"><span>Plan</span><strong>{draft.plan}</strong></div>
            <div className="detail-item"><span>Start</span><strong>{formatUkDate(draft.startsAt)}</strong></div>
            <div className="detail-item"><span>Expiry</span><strong>{formatUkDate(draft.expiresAt)}</strong></div>
            <div className="detail-item"><span>Max devices</span><strong>{draft.maxDevices}</strong></div>
            <div className="detail-item"><span>Features</span><strong>{draft.features.join(', ')}</strong></div>
            <div className="detail-item"><span>Payment status</span><strong>{draft.paymentStatus}</strong></div>
            <div className="detail-item"><span>Amount</span><strong>{formatMoney(draft.amountPence)}</strong></div>
            <div className="detail-item"><span>Method</span><strong>{draft.paymentMethod || '—'}</strong></div>
            <div className="detail-item"><span>Payment ref</span><strong>{draft.paymentReference || '—'}</strong></div>
            <div className="detail-item"><span>Invoice ref</span><strong>{draft.invoiceReference || '—'}</strong></div>
            <div className="detail-item"><span>Signing key</span><strong>{signingStatus?.keyId ?? '—'}</strong></div>
            <div className="detail-item"><span>Algorithm</span><strong>Ed25519</strong></div>
          </div>

          <WarningBanner
            title="Issuing creates a signed TG1 licence"
            message="The full TG1 key is shown only on successful issuance and is not written to browser storage."
          />

          <label className="confirm-check" htmlFor="issue-confirm">
            <input
              id="issue-confirm"
              name="confirmed"
              type="checkbox"
              checked={draft.confirmed}
              onChange={(event) => patchDraft({ confirmed: event.target.checked })}
            />
            <span>I have reviewed the customer, licence dates, device limit, features and payment details.</span>
          </label>

          <ButtonRow>
            <button type="button" className="secondary-button" onClick={() => goTo('payment')}>Back</button>
            <button
              type="button"
              className="primary-button"
              disabled={!draft.confirmed || isSubmitting || !signingStatus?.ready}
              onClick={() => void handleIssue()}
            >
              {isSubmitting ? 'Issuing…' : 'Issue and sign licence'}
            </button>
          </ButtonRow>
          {!signingStatus?.ready ? (
            <ErrorBanner message="Signing key is not ready. Configure the licence API signing key before issuing." />
          ) : null}
        </Card>
      ) : null}

      {showCreateCustomer ? (
        <CreateCustomerModal
          accessToken={accessToken}
          onClose={() => setShowCreateCustomer(false)}
          onCreated={(customer) => {
            setCustomers((current) => [customer, ...current]);
            patchDraft({
              customerId: customer.id,
              customerEmail: customer.email,
              customerSnapshot: {
                id: customer.id,
                companyName: customer.companyName,
                contactName: customer.contactName,
                email: customer.email,
                status: customer.status,
              },
            });
            setShowCreateCustomer(false);
          }}
        />
      ) : null}
    </div>
  );
}

function CreateCustomerModal({
  accessToken,
  onClose,
  onCreated,
}: {
  accessToken: string | null;
  onClose: () => void;
  onCreated: (customer: CustomerSummary) => void;
}): JSX.Element {
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!accessToken) {
      return;
    }
    setIsCreating(true);
    setError(null);
    const body: CreateCustomerRequest = {
      companyName: companyName.trim(),
      email: email.trim(),
      contactName: contactName.trim() || undefined,
      status: 'ACTIVE',
    };
    try {
      const created = await apiRequest<CustomerSummary>('/admin/customers', {
        method: 'POST',
        body: JSON.stringify(body),
      }, accessToken);
      onCreated({
        ...created,
        status: created.status ?? 'ACTIVE',
        updatedAt: created.updatedAt ?? new Date().toISOString(),
      });
    } catch (submissionError) {
      setError(formatError(submissionError, 'Failed to create customer'));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-customer-title" onClick={(event) => event.stopPropagation()}>
        <h3 id="create-customer-title">Create new customer</h3>
        <form className="page-stack" onSubmit={(event) => void handleSubmit(event)}>
          <Field label="Company name">
            <input id="create-company" name="companyName" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required minLength={2} />
          </Field>
          <Field label="Billing email">
            <input id="create-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          <Field label="Contact name">
            <input id="create-contact" name="contactName" value={contactName} onChange={(event) => setContactName(event.target.value)} />
          </Field>
          {error ? <ErrorBanner message={error} /> : null}
          <ButtonRow>
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={isCreating}>
              {isCreating ? 'Creating…' : 'Create customer'}
            </button>
          </ButtonRow>
        </form>
      </div>
    </div>
  );
}
