import { FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../lib/api';
import { buildLicenceFilename } from '../lib/licence-file';
import { ButtonRow, ErrorBanner, Field, WarningBanner } from './ui';

export type EmailLicenceSource = 'issue-success' | 'licence-detail';

export interface EmailLicenceResult {
  success: boolean;
  recipient: string;
  subject: string;
  attachmentFilename: string;
  errorMessage?: string;
  errorCode?: string;
}

export function EmailLicenceModal({
  licenceId,
  humanLicenseId,
  defaultRecipient,
  defaultSubject,
  accessToken,
  source,
  fullLicenseKey,
  requirePassword,
  onClose,
  onSent,
  onDownloadInstead,
}: {
  licenceId: string;
  humanLicenseId: string;
  defaultRecipient: string;
  defaultSubject: string;
  accessToken: string;
  source: EmailLicenceSource;
  fullLicenseKey?: string;
  requirePassword: boolean;
  onClose: () => void;
  onSent: (result: EmailLicenceResult) => void;
  onDownloadInstead?: () => void;
}): JSX.Element {
  const [recipientEmail, setRecipientEmail] = useState(defaultRecipient);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const attachmentFilename = buildLicenceFilename(humanLicenseId);

  useEffect(() => {
    if (requirePassword) {
      passwordRef.current?.focus();
    } else {
      firstFieldRef.current?.focus();
    }
  }, [requirePassword]);

  function clearSensitiveAndClose(): void {
    setPassword('');
    setError(null);
    setSendFailed(false);
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }
    if (!recipientEmail.trim()) {
      setError('Recipient email is required.');
      return;
    }
    if (requirePassword && !password) {
      setError('Administrator password is required.');
      return;
    }
    if (source === 'issue-success' && !fullLicenseKey?.startsWith('TG1.')) {
      setError('The full licence key is no longer available in this screen. Use Email licence from the licence detail page.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    setSendFailed(false);

    try {
      const response = await apiRequest<EmailLicenceResult>(
        `/admin/licences/${licenceId}/email`,
        {
          method: 'POST',
          body: JSON.stringify({
            recipientEmail: recipientEmail.trim(),
            subject: subject.trim() || undefined,
            message: message.trim() || undefined,
            password: requirePassword ? password : undefined,
            source,
            fullLicenseKey: source === 'issue-success' ? fullLicenseKey : undefined,
          }),
          cache: 'no-store',
        },
        accessToken,
      );

      if (!response.success) {
        setError(
          response.errorMessage
            ? `${response.errorMessage} The licence remains valid.`
            : 'Email could not be sent. The licence remains valid.',
        );
        setSendFailed(true);
        setPassword('');
        return;
      }

      onSent(response);
      clearSensitiveAndClose();
    } catch (submissionError) {
      const messageText =
        submissionError instanceof ApiError
          ? submissionError.message
          : submissionError instanceof Error
            ? submissionError.message
            : 'Email could not be sent. The licence remains valid.';
      setError(`${messageText}${messageText.includes('remains valid') ? '' : ' The licence remains valid.'}`);
      setSendFailed(true);
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
        aria-labelledby="email-licence-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="email-licence-title">Email licence</h3>
        <WarningBanner
          title="Secure attachment"
          message="This email will include the full commercial licence as an attachment."
        />
        <form className="page-stack" onSubmit={(event) => void handleSubmit(event)}>
          <Field label="To">
            <input
              ref={firstFieldRef}
              type="email"
              autoComplete="email"
              value={recipientEmail}
              onChange={(event) => setRecipientEmail(event.target.value)}
              required
              disabled={isSubmitting}
            />
          </Field>
          <Field label="Subject">
            <input
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={200}
              disabled={isSubmitting}
            />
          </Field>
          <Field label="Optional message" hint="Shown as a short introductory note. The structured licence template is always included.">
            <textarea
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2000}
              disabled={isSubmitting}
            />
          </Field>
          <div className="detail-item">
            <span>Attachment</span>
            <strong>{attachmentFilename}</strong>
          </div>
          {requirePassword ? (
            <Field label="Current password">
              <input
                ref={passwordRef}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={isSubmitting}
              />
            </Field>
          ) : null}
          {error ? <ErrorBanner message={error} /> : null}
          <ButtonRow>
            <button type="button" className="secondary-button" onClick={clearSensitiveAndClose} disabled={isSubmitting}>
              Cancel
            </button>
            {sendFailed && onDownloadInstead ? (
              <button
                type="button"
                className="secondary-button"
                disabled={isSubmitting}
                onClick={() => {
                  clearSensitiveAndClose();
                  onDownloadInstead();
                }}
              >
                Download licence instead
              </button>
            ) : null}
            <button
              type="submit"
              className="primary-button"
              disabled={isSubmitting || !recipientEmail.trim() || (requirePassword && !password)}
            >
              {isSubmitting ? 'Sending…' : sendFailed ? 'Retry' : 'Send'}
            </button>
          </ButtonRow>
        </form>
      </div>
    </div>
  );
}
