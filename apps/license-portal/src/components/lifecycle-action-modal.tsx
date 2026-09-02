import { FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../lib/api';
import { formatUkDate, toIsoDate } from '../lib/dates';
import { OFFLINE_ENFORCEMENT_LIMITS_TEXT } from './layout';
import { ButtonRow, ErrorBanner, Field, InfoBanner, StatusBadge, WarningBanner } from './ui';
import type { LicenceDetail, LicensePlan, LifecycleActionResponse } from '../types';

export type LifecycleActionType =
  | 'reissue'
  | 'suspend'
  | 'reactivate'
  | 'change-plan'
  | 'change-device-limit'
  | 'revoke';

const PLAN_OPTIONS: LicensePlan[] = ['TRIAL', 'MONTHLY', 'ANNUAL'];

interface ActionConfig {
  title: string;
  endpoint: (id: string) => string;
  impact: string;
  submitLabel: string;
  submittingLabel: string;
  danger?: boolean;
  supportsEmail?: boolean;
}

const ACTION_CONFIG: Record<LifecycleActionType, ActionConfig> = {
  reissue: {
    title: 'Reissue licence',
    endpoint: (id) => `/admin/licences/${id}/reissue`,
    impact:
      'Re-signs the current plan, validity window, device limit and features with a brand new TG1 key. No dates or entitlements change.',
    submitLabel: 'Reissue licence',
    submittingLabel: 'Reissuing…',
    supportsEmail: true,
  },
  suspend: {
    title: 'Suspend licence',
    endpoint: (id) => `/admin/licences/${id}/suspend`,
    impact:
      'Marks the licence SUSPENDED in the admin portal. No new TG1 is issued — the previously issued licence file remains valid on the customer device until it naturally expires or is replaced.',
    submitLabel: 'Suspend licence',
    submittingLabel: 'Suspending…',
  },
  reactivate: {
    title: 'Reactivate licence',
    endpoint: (id) => `/admin/licences/${id}/reactivate`,
    impact:
      'Returns a SUSPENDED licence to ACTIVE. No new TG1 is produced. If the validity window already expired while suspended, renew the licence first.',
    submitLabel: 'Reactivate licence',
    submittingLabel: 'Reactivating…',
    supportsEmail: true,
  },
  'change-plan': {
    title: 'Change plan',
    endpoint: (id) => `/admin/licences/${id}/change-plan`,
    impact: 'Re-signs the current validity window under the new plan tier and issues a new TG1 that the customer must import.',
    submitLabel: 'Change plan',
    submittingLabel: 'Changing plan…',
    supportsEmail: true,
  },
  'change-device-limit': {
    title: 'Change device limit',
    endpoint: (id) => `/admin/licences/${id}/change-device-limit`,
    impact: 'Updates the maximum device count and issues a new TG1 reflecting the change.',
    submitLabel: 'Change device limit',
    submittingLabel: 'Updating…',
    supportsEmail: true,
  },
  revoke: {
    title: 'Revoke licence',
    endpoint: (id) => `/admin/licences/${id}/revoke`,
    impact: 'Permanently revokes this licence. This cannot be undone and blocks all further lifecycle actions on this record.',
    submitLabel: 'Revoke licence',
    submittingLabel: 'Revoking…',
    danger: true,
  },
};

function formatError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.code && !error.message.startsWith(`${error.code}:`) ? `${error.code}: ${error.message}` : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function LifecycleActionModal({
  action,
  licence,
  accessToken,
  onClose,
  onSuccess,
}: {
  action: LifecycleActionType;
  licence: LicenceDetail;
  accessToken: string;
  onClose: () => void;
  onSuccess: (result: LifecycleActionResponse) => void;
}): JSX.Element {
  const config = ACTION_CONFIG[action];
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [confirmationText, setConfirmationText] = useState('');
  const [emailAfter, setEmailAfter] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState(licence.customerEmail ?? '');
  const [newPlan, setNewPlan] = useState<LicensePlan>(licence.plan);
  const [validFromInput, setValidFromInput] = useState(formatUkDate(licence.startsAt));
  const [validFrom, setValidFrom] = useState(licence.startsAt);
  const [maxDevices, setMaxDevices] = useState(licence.maxDevices);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const expectedConfirmation = `REVOKE ${licence.licenseId}`;
  const revokeMismatch = action === 'revoke' && confirmationText.trim() !== expectedConfirmation;

  function clearSensitiveAndClose(): void {
    setPassword('');
    setConfirmationText('');
    setError(null);
    onClose();
  }

  function validate(): string | null {
    if (action === 'suspend' || action === 'reissue' || action === 'change-plan' || action === 'change-device-limit') {
      if (reason.trim().length < 3) {
        return 'Reason must be at least 3 characters.';
      }
    }
    if (action === 'revoke') {
      if (reason.trim().length < 3) {
        return 'Reason must be at least 3 characters.';
      }
      if (confirmationText.trim() !== expectedConfirmation) {
        return `Confirmation text must exactly match "${expectedConfirmation}".`;
      }
    }
    if (!password) {
      return 'Password is required.';
    }
    if (config.supportsEmail && emailAfter && !recipientEmail.trim()) {
      return 'Recipient email is required when sending a copy.';
    }
    if (action === 'change-device-limit') {
      if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 100) {
        return 'Maximum devices must be an integer between 1 and 100.';
      }
    }
    return null;
  }

  function buildBody(): Record<string, unknown> {
    switch (action) {
      case 'reissue':
        return {
          reason: reason.trim(),
          password,
          emailAfterReissue: emailAfter || undefined,
          recipientEmail: emailAfter ? recipientEmail.trim() : undefined,
        };
      case 'suspend':
        return { reason: reason.trim(), password };
      case 'reactivate':
        return {
          reason: reason.trim() || undefined,
          password,
          emailUpdatedLicence: emailAfter || undefined,
          recipientEmail: emailAfter ? recipientEmail.trim() : undefined,
        };
      case 'change-plan':
        return {
          newPlan,
          validFrom: validFrom || undefined,
          reason: reason.trim(),
          password,
          emailUpdatedLicence: emailAfter || undefined,
          recipientEmail: emailAfter ? recipientEmail.trim() : undefined,
        };
      case 'change-device-limit':
        return {
          maxDevices,
          reason: reason.trim(),
          password,
          emailUpdatedLicence: emailAfter || undefined,
          recipientEmail: emailAfter ? recipientEmail.trim() : undefined,
        };
      case 'revoke':
        return {
          reason: reason.trim(),
          confirmationText: confirmationText.trim(),
          password,
        };
      default:
        return {};
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await apiRequest<LifecycleActionResponse>(
        config.endpoint(licence.id),
        { method: 'POST', body: JSON.stringify(buildBody()), cache: 'no-store' },
        accessToken,
      );
      setPassword('');
      setConfirmationText('');
      onSuccess(response);
    } catch (submissionError) {
      setError(formatError(submissionError, `${config.title} failed`));
      setPassword('');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={clearSensitiveAndClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lifecycle-action-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="lifecycle-action-title">{config.title}</h3>

        <div className="detail-grid">
          <div className="detail-item">
            <span>Licence ID</span>
            <strong>{licence.licenseId}</strong>
          </div>
          <div className="detail-item">
            <span>Customer</span>
            <strong>{licence.customerName ?? '—'}</strong>
          </div>
          <div className="detail-item">
            <span>Plan</span>
            <strong>{licence.plan}</strong>
          </div>
          <div className="detail-item">
            <span>Status</span>
            <strong>
              <StatusBadge value={licence.status} />
            </strong>
          </div>
          <div className="detail-item">
            <span>Validity</span>
            <strong>
              {formatUkDate(licence.startsAt)} – {formatUkDate(licence.expiresAt)}
            </strong>
          </div>
          <div className="detail-item">
            <span>Max devices</span>
            <strong>{licence.maxDevices}</strong>
          </div>
        </div>

        {config.danger ? (
          <WarningBanner title="This cannot be undone" message={config.impact} />
        ) : (
          <InfoBanner title="What this does" message={config.impact} />
        )}
        <InfoBanner title="Offline enforcement limits" message={OFFLINE_ENFORCEMENT_LIMITS_TEXT} />

        <form className="page-stack" onSubmit={(event) => void handleSubmit(event)}>
          {action === 'change-plan' ? (
            <div className="two-column-grid">
              <Field label="New plan">
                <select value={newPlan} onChange={(event) => setNewPlan(event.target.value as LicensePlan)} disabled={isSubmitting}>
                  {PLAN_OPTIONS.map((plan) => (
                    <option key={plan} value={plan}>
                      {plan}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Effective from (DD/MM/YYYY)" hint="Defaults to the current start date.">
                <input
                  defaultValue={validFromInput}
                  disabled={isSubmitting}
                  onBlur={(event) => {
                    try {
                      const iso = toIsoDate(event.target.value);
                      setValidFrom(iso);
                      setValidFromInput(formatUkDate(iso));
                      setError(null);
                    } catch (dateError) {
                      setError(dateError instanceof Error ? dateError.message : 'Invalid date');
                    }
                  }}
                />
              </Field>
            </div>
          ) : null}

          {action === 'change-device-limit' ? (
            <Field label="Maximum devices">
              <input
                type="number"
                min={1}
                max={100}
                value={maxDevices}
                disabled={isSubmitting}
                onChange={(event) => setMaxDevices(Number(event.target.value))}
              />
            </Field>
          ) : null}

          {action === 'revoke' ? (
            <Field label={`Type "${expectedConfirmation}" to confirm`} hint="Must match exactly, including the licence ID.">
              <input
                ref={firstFieldRef}
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                disabled={isSubmitting}
                autoComplete="off"
                required
              />
            </Field>
          ) : null}

          {action === 'reactivate' ? (
            <Field label="Reason (optional)">
              <input
                ref={action === 'reactivate' ? firstFieldRef : undefined}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={isSubmitting}
              />
            </Field>
          ) : (
            <Field label="Reason" hint="At least 3 characters. Recorded on the audit trail.">
              <input
                ref={action !== 'revoke' ? firstFieldRef : undefined}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={isSubmitting}
                required
                minLength={3}
              />
            </Field>
          )}

          {config.supportsEmail ? (
            <>
              <label className="confirm-check" htmlFor="lifecycle-email-toggle">
                <input
                  id="lifecycle-email-toggle"
                  type="checkbox"
                  checked={emailAfter}
                  onChange={(event) => setEmailAfter(event.target.checked)}
                  disabled={isSubmitting}
                />
                <span>Email the updated licence file to the customer now.</span>
              </label>
              {emailAfter ? (
                <Field label="Recipient email">
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(event) => setRecipientEmail(event.target.value)}
                    disabled={isSubmitting}
                    required
                  />
                </Field>
              ) : null}
            </>
          ) : null}

          <Field label="Administrator password">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
              required
            />
          </Field>

          {error ? <ErrorBanner message={error} /> : null}

          <ButtonRow>
            <button type="button" className="secondary-button" onClick={clearSensitiveAndClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="submit"
              className={config.danger ? 'danger-button' : 'primary-button'}
              disabled={isSubmitting || !password || (action === 'revoke' && revokeMismatch)}
            >
              {isSubmitting ? config.submittingLabel : config.submitLabel}
            </button>
          </ButtonRow>
        </form>
      </div>
    </div>
  );
}
