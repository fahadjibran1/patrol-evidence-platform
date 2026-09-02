import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiRequest, copyToClipboard } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatUkDate, todayIsoDate, toIsoDate } from '../lib/dates';
import { downloadLicenceFile } from '../lib/licence-file';
import {
  computeCalendarExpiresAt,
  computeRenewalContinuityFrom,
  RENEWAL_PERIOD_DESCRIPTIONS,
  type RenewalPeriodOption,
} from '../lib/plan-dates';
import { canRenewLicences } from '../lib/roles';
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
import type { LicenceDetail, LicensePlan, RenewLicenceRequest, RenewLicenceResponse } from '../types';

const RENEW_STEPS = ['period', 'details', 'notify', 'confirm'] as const;
type RenewStep = (typeof RENEW_STEPS)[number];

const RENEW_STEP_LABELS: Record<RenewStep, string> = {
  period: 'Renewal period',
  details: 'Validity & entitlement',
  notify: 'Notify & authorise',
  confirm: 'Review & confirm',
};

const PLAN_OPTIONS: LicensePlan[] = ['TRIAL', 'MONTHLY', 'ANNUAL'];
const RENEWAL_PERIODS: RenewalPeriodOption[] = ['MONTHLY', 'ANNUAL', 'CUSTOM'];

function formatError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.code && !error.message.startsWith(`${error.code}:`) ? `${error.code}: ${error.message}` : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function RenewLicencePage(): JSX.Element {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { accessToken, admin } = useAuth();
  const isSuperAdmin = admin?.role === 'SUPER_ADMIN';

  const [licence, setLicence] = useState<LicenceDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [step, setStep] = useState<RenewStep>('period');
  const [renewalPeriod, setRenewalPeriod] = useState<RenewalPeriodOption>('ANNUAL');
  const [allowDateOverride, setAllowDateOverride] = useState(false);
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [plan, setPlan] = useState<LicensePlan>('ANNUAL');
  const [maxDevices, setMaxDevices] = useState(1);
  const [reason, setReason] = useState('');
  const [emailAfterRenewal, setEmailAfterRenewal] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [password, setPassword] = useState('');
  const [stepError, setStepError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const [renewResult, setRenewResult] = useState<RenewLicenceResponse | null>(null);
  const [versionNumber, setVersionNumber] = useState<number | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !id) {
      return;
    }

    void apiRequest<LicenceDetail>(`/admin/licences/${id}`, {}, accessToken)
      .then((response) => {
        setLicence(response);
        setPlan(response.plan);
        setMaxDevices(response.maxDevices);
        const today = todayIsoDate();
        const from = computeRenewalContinuityFrom(response.expiresAt, today);
        setValidFrom(from);
        setValidUntil(computeCalendarExpiresAt(from, 'ANNUAL'));
      })
      .catch((error) => setLoadError(formatError(error, 'Failed to load licence')))
      .finally(() => setIsLoading(false));
  }, [accessToken, id]);

  // Clear the password whenever the wizard unmounts (navigating away / closing).
  useEffect(() => {
    return () => setPassword('');
  }, []);

  function recomputeWindow(period: RenewalPeriodOption, from: string): void {
    if (period === 'CUSTOM') {
      setValidUntil((current) => (current && current >= from ? current : from));
      return;
    }
    setValidUntil(computeCalendarExpiresAt(from, period));
  }

  function goTo(next: RenewStep): void {
    setStepError(null);
    setStep(next);
  }

  function validatePeriodStep(): boolean {
    if (!RENEWAL_PERIODS.includes(renewalPeriod)) {
      setStepError('Select a renewal period.');
      return false;
    }
    return true;
  }

  function validateDetailsStep(): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
      setStepError('Valid-from date is invalid.');
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
      setStepError('Valid-until date is invalid.');
      return false;
    }
    if (validFrom > validUntil) {
      setStepError('Valid-until must be on or after valid-from.');
      return false;
    }
    if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 100) {
      setStepError('Maximum devices must be an integer between 1 and 100.');
      return false;
    }
    return true;
  }

  function validateNotifyStep(): boolean {
    if (emailAfterRenewal && !recipientEmail.trim()) {
      setStepError('Recipient email is required to send a copy now.');
      return false;
    }
    if (!password) {
      setStepError('Administrator password is required.');
      return false;
    }
    return true;
  }

  async function handleConfirm(): Promise<void> {
    if (!accessToken || submittingRef.current) {
      return;
    }
    if (!validatePeriodStep() || !validateDetailsStep() || !validateNotifyStep()) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setStepError(null);

    const body: RenewLicenceRequest = {
      renewalPeriod,
      validFrom,
      validUntil: renewalPeriod === 'CUSTOM' ? validUntil : undefined,
      plan: plan !== licence?.plan ? plan : undefined,
      maxDevices: maxDevices !== licence?.maxDevices ? maxDevices : undefined,
      reason: reason.trim() || undefined,
      emailAfterRenewal: emailAfterRenewal || undefined,
      recipientEmail: emailAfterRenewal ? recipientEmail.trim() : undefined,
      allowDateOverride: isSuperAdmin && allowDateOverride ? true : undefined,
      password,
    };

    try {
      const response = await apiRequest<RenewLicenceResponse>(
        `/admin/licences/${id}/renew`,
        { method: 'POST', body: JSON.stringify(body), cache: 'no-store' },
        accessToken,
      );
      setRenewResult(response);
      setPassword('');

      // The renew response does not carry the new version number, so fetch the refreshed
      // detail (which includes the version history) to surface it on the success screen.
      try {
        const refreshed = await apiRequest<LicenceDetail>(`/admin/licences/${id}`, {}, accessToken);
        const latest = (refreshed.versions ?? []).reduce(
          (max, entry) => Math.max(max, entry.versionNumber),
          0,
        );
        setVersionNumber(latest > 0 ? latest : null);
      } catch {
        setVersionNumber(null);
      }
    } catch (submissionError) {
      setStepError(formatError(submissionError, 'Renewal failed'));
      setPassword('');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  const canRenew = canRenewLicences(admin?.role);
  const eligibleStatuses = useMemo(() => new Set(['ACTIVE', 'SUSPENDED', 'EXPIRED']), []);

  if (!canRenew) {
    return (
      <div className="page-stack">
        <PageHeader title="Renew licence" subtitle="Renewal is restricted to ADMIN and SUPER_ADMIN roles." />
        <ErrorBanner message="SUPPORT users cannot renew licences." />
        <Link to="/licences" className="secondary-button">Return to licences</Link>
      </div>
    );
  }

  if (isLoading) {
    return <LoadingState label="Loading licence…" />;
  }

  if (!licence) {
    return <ErrorBanner message={loadError ?? 'Licence not found.'} />;
  }

  if (!eligibleStatuses.has(licence.status)) {
    return (
      <div className="page-stack">
        <PageHeader title={`Renew ${licence.licenseId}`} />
        <ErrorBanner message={`This licence has status ${licence.status} and cannot be renewed.`} />
        <Link to={`/licences/${licence.id}`} className="secondary-button">Back to licence</Link>
      </div>
    );
  }

  if (renewResult) {
    const key = renewResult.fullLicenseKey ?? renewResult.signedLicenseKey;
    return (
      <div className="page-stack">
        <PageHeader
          title="Licence renewed"
          subtitle={`${renewResult.licenseId} · ${versionNumber ? `version ${versionNumber}` : 'renewal recorded'}`}
        />
        <InfoBanner
          title="New TG1 key issued"
          message="This renewal produced a replacement TG1. It is held only in this success screen's memory — never written to browser storage."
        />
        <Card>
          <div className="detail-grid">
            <div className="detail-item"><span>Licence ID</span><strong>{renewResult.licenseId}</strong></div>
            <div className="detail-item"><span>Version</span><strong>{versionNumber ?? '—'}</strong></div>
            <div className="detail-item"><span>Plan</span><strong>{renewResult.plan}</strong></div>
            <div className="detail-item"><span>New expiry</span><strong>{formatUkDate(renewResult.expiresAt)}</strong></div>
            <div className="detail-item"><span>Max devices</span><strong>{renewResult.maxDevices}</strong></div>
          </div>

          {renewResult.emailResult ? (
            renewResult.emailResult.success ? (
              <p className="success-text">Emailed to {renewResult.emailResult.recipient}.</p>
            ) : (
              <ErrorBanner message={renewResult.emailResult.errorMessage ?? 'Email delivery failed. The renewal remains valid.'} />
            )
          ) : null}

          <WarningBanner title="Protected TG1 key" message="Download or email the key now — it will not be shown again from this screen." />

          <ButtonRow>
            <button
              type="button"
              className="primary-button"
              disabled={!key}
              onClick={() => {
                if (!key || !accessToken) {
                  return;
                }
                const result = downloadLicenceFile(renewResult.licenseId, key);
                setCopyMessage(`${result.fileName} downloaded.`);
                void apiRequest(
                  `/admin/licences/${renewResult.id}/download-event`,
                  { method: 'POST', body: JSON.stringify({ source: 'licence-detail' }) },
                  accessToken,
                ).catch(() => undefined);
              }}
            >
              Download licence file
            </button>
            {!renewResult.emailResult?.success ? (
              <button type="button" className="secondary-button" disabled={!key} onClick={() => setShowEmailModal(true)}>
                Email licence
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              disabled={!key}
              onClick={() => {
                if (!key) {
                  return;
                }
                void copyToClipboard(key).then(() => setCopyMessage('TG1 key copied.'));
              }}
            >
              Copy full TG1 key
            </button>
            <button type="button" className="secondary-button" onClick={() => navigate(`/licences/${renewResult.id}`)}>
              Back to licence
            </button>
          </ButtonRow>
          {copyMessage ? <p className="success-text">{copyMessage}</p> : null}
        </Card>

        {showEmailModal && accessToken && key ? (
          <EmailLicenceModal
            licenceId={renewResult.id}
            humanLicenseId={renewResult.licenseId}
            defaultRecipient={renewResult.customerEmail ?? ''}
            defaultSubject={`Your renewed Patrol Evidence Platform Licence – ${renewResult.licenseId}`}
            accessToken={accessToken}
            source="licence-detail"
            requirePassword
            onClose={() => setShowEmailModal(false)}
            onSent={(result) => setCopyMessage(`Licence emailed successfully to ${result.recipient}.`)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader title={`Renew ${licence.licenseId}`} subtitle={`Current expiry ${formatUkDate(licence.expiresAt)}`} />
      <WizardStepper current={step} steps={RENEW_STEPS} labels={RENEW_STEP_LABELS} ariaLabel="Renew licence steps" />
      {stepError ? <ErrorBanner message={stepError} /> : null}

      {step === 'period' ? (
        <Card>
          <div className="detail-grid">
            <div className="detail-item"><span>Customer</span><strong>{licence.customerName ?? '—'}</strong></div>
            <div className="detail-item"><span>Current plan</span><strong>{licence.plan}</strong></div>
            <div className="detail-item"><span>Status</span><strong><StatusBadge value={licence.status} /></strong></div>
            <div className="detail-item"><span>Current validity</span><strong>{formatUkDate(licence.startsAt)} – {formatUkDate(licence.expiresAt)}</strong></div>
            <div className="detail-item"><span>Max devices</span><strong>{licence.maxDevices}</strong></div>
          </div>

          <div className="plan-cards">
            {RENEWAL_PERIODS.map((period) => (
              <button
                key={period}
                type="button"
                className={`plan-card ${renewalPeriod === period ? 'selected' : ''}`}
                onClick={() => {
                  setRenewalPeriod(period);
                  recomputeWindow(period, validFrom);
                }}
              >
                <strong>{period}</strong>
                <p>{RENEWAL_PERIOD_DESCRIPTIONS[period]}</p>
              </button>
            ))}
          </div>

          <ButtonRow>
            <Link to={`/licences/${id}`} className="secondary-button">Cancel</Link>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (validatePeriodStep()) {
                  goTo('details');
                }
              }}
            >
              Continue
            </button>
          </ButtonRow>
        </Card>
      ) : null}

      {step === 'details' ? (
        <Card>
          {isSuperAdmin ? (
            <label className="confirm-check" htmlFor="renew-override">
              <input
                id="renew-override"
                type="checkbox"
                checked={allowDateOverride}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setAllowDateOverride(checked);
                  if (!checked) {
                    const from = computeRenewalContinuityFrom(licence.expiresAt, todayIsoDate());
                    setValidFrom(from);
                    recomputeWindow(renewalPeriod, from);
                  }
                }}
              />
              <span>
                Override the continuity start date (SUPER_ADMIN only). Without this, valid-from must continue immediately
                from the current expiry.
              </span>
            </label>
          ) : null}

          <div className="two-column-grid">
            <Field
              label="Valid from (DD/MM/YYYY)"
              hint={isSuperAdmin && allowDateOverride ? 'Overriding the continuity default.' : 'Continues from the current expiry.'}
            >
              <input
                key={validFrom}
                defaultValue={formatUkDate(validFrom)}
                disabled={!(isSuperAdmin && allowDateOverride)}
                onBlur={(event) => {
                  try {
                    const iso = toIsoDate(event.target.value);
                    setValidFrom(iso);
                    recomputeWindow(renewalPeriod, iso);
                    setStepError(null);
                  } catch (dateError) {
                    setStepError(dateError instanceof Error ? dateError.message : 'Invalid date');
                  }
                }}
              />
            </Field>
            <Field
              label="Valid until (DD/MM/YYYY)"
              hint={renewalPeriod === 'CUSTOM' ? 'Choose the exact end date.' : 'Calculated automatically from valid-from.'}
            >
              <input
                key={validUntil}
                defaultValue={formatUkDate(validUntil)}
                disabled={renewalPeriod !== 'CUSTOM'}
                onBlur={(event) => {
                  try {
                    const iso = toIsoDate(event.target.value);
                    setValidUntil(iso);
                    setStepError(null);
                  } catch (dateError) {
                    setStepError(dateError instanceof Error ? dateError.message : 'Invalid date');
                  }
                }}
              />
            </Field>
          </div>

          <div className="two-column-grid">
            <Field label="Plan" hint="Optional. Defaults to the current plan.">
              <select value={plan} onChange={(event) => setPlan(event.target.value as LicensePlan)}>
                {PLAN_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </Field>
            <Field label="Maximum devices" hint="Optional. Defaults to the current limit.">
              <input
                type="number"
                min={1}
                max={100}
                value={maxDevices}
                onChange={(event) => setMaxDevices(Number(event.target.value))}
              />
            </Field>
          </div>

          <Field label="Renewal reason (optional)">
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} />
          </Field>

          <ButtonRow>
            <button type="button" className="secondary-button" onClick={() => goTo('period')}>Back</button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (validateDetailsStep()) {
                  goTo('notify');
                }
              }}
            >
              Continue
            </button>
          </ButtonRow>
        </Card>
      ) : null}

      {step === 'notify' ? (
        <Card>
          <label className="confirm-check" htmlFor="renew-email-toggle">
            <input
              id="renew-email-toggle"
              type="checkbox"
              checked={emailAfterRenewal}
              onChange={(event) => setEmailAfterRenewal(event.target.checked)}
            />
            <span>Email the renewed licence to the customer immediately after renewal.</span>
          </label>
          {emailAfterRenewal ? (
            <Field label="Recipient email">
              <input
                type="email"
                value={recipientEmail}
                onChange={(event) => setRecipientEmail(event.target.value)}
                placeholder={licence.customerEmail ?? ''}
                required
              />
            </Field>
          ) : null}

          <Field label="Administrator password" hint="Required to authorise this lifecycle action.">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          <ButtonRow>
            <button type="button" className="secondary-button" onClick={() => goTo('details')}>Back</button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (validateNotifyStep()) {
                  goTo('confirm');
                }
              }}
            >
              Continue
            </button>
          </ButtonRow>
        </Card>
      ) : null}

      {step === 'confirm' ? (
        <Card>
          <h3>Current vs. after renewal</h3>
          <div className="two-column-grid">
            <div className="detail-grid">
              <div className="detail-item"><span>Current plan</span><strong>{licence.plan}</strong></div>
              <div className="detail-item"><span>Current devices</span><strong>{licence.maxDevices}</strong></div>
              <div className="detail-item"><span>Current validity</span><strong>{formatUkDate(licence.startsAt)} – {formatUkDate(licence.expiresAt)}</strong></div>
            </div>
            <div className="detail-grid">
              <div className="detail-item"><span>New plan</span><strong>{plan}</strong></div>
              <div className="detail-item"><span>New devices</span><strong>{maxDevices}</strong></div>
              <div className="detail-item"><span>New validity</span><strong>{formatUkDate(validFrom)} – {formatUkDate(validUntil)}</strong></div>
            </div>
          </div>

          <div className="detail-grid">
            <div className="detail-item"><span>Renewal period</span><strong>{renewalPeriod}</strong></div>
            <div className="detail-item"><span>Reason</span><strong>{reason.trim() || '—'}</strong></div>
            <div className="detail-item"><span>Email on renewal</span><strong>{emailAfterRenewal ? recipientEmail : 'No'}</strong></div>
          </div>

          <WarningBanner
            title="Renewing issues a new TG1"
            message="The customer must import the new .lic file to receive the updated validity window. The full key is shown only on the success screen and is not written to browser storage."
          />

          <ButtonRow>
            <button type="button" className="secondary-button" onClick={() => goTo('notify')} disabled={isSubmitting}>Back</button>
            <button type="button" className="primary-button" disabled={isSubmitting} onClick={() => void handleConfirm()}>
              {isSubmitting ? 'Renewing…' : 'Confirm and renew'}
            </button>
          </ButtonRow>
        </Card>
      ) : null}
    </div>
  );
}
