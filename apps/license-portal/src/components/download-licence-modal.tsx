import { FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../lib/api';
import { downloadLicenceFile } from '../lib/licence-file';
import { ButtonRow, ErrorBanner, Field } from './ui';

export function DownloadLicenceModal({
  licenceId,
  humanLicenseId,
  accessToken,
  onClose,
  onDownloaded,
}: {
  licenceId: string;
  humanLicenseId: string;
  accessToken: string;
  onClose: () => void;
  onDownloaded: (fileName: string) => void;
}): JSX.Element {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  function clearAndClose(): void {
    setPassword('');
    setError(null);
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);

    let revealedKey: string | null = null;
    try {
      const response = await apiRequest<{
        licenseId: string;
        signedLicenseKey?: string;
        fullLicenseKey?: string;
      }>(
        `/admin/licences/${licenceId}/reveal`,
        {
          method: 'POST',
          body: JSON.stringify({ password }),
          cache: 'no-store',
        },
        accessToken,
      );

      revealedKey = response.fullLicenseKey ?? response.signedLicenseKey ?? null;
      if (!revealedKey) {
        throw new Error('Reveal response did not include a licence key');
      }

      const result = downloadLicenceFile(response.licenseId || humanLicenseId, revealedKey);
      await apiRequest(
        `/admin/licences/${licenceId}/download-event`,
        {
          method: 'POST',
          body: JSON.stringify({ source: 'licence-detail' }),
        },
        accessToken,
      ).catch(() => undefined);

      onDownloaded(result.fileName);
      clearAndClose();
    } catch (submissionError) {
      const message =
        submissionError instanceof ApiError
          ? submissionError.message
          : submissionError instanceof Error
            ? submissionError.message
            : 'Could not download licence file';
      setError(message);
    } finally {
      revealedKey = null;
      setPassword('');
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={clearAndClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-licence-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="download-licence-title">Download full licence</h3>
        <p className="muted-text">
          To protect commercial licence keys, confirm your administrator password.
        </p>
        <form className="page-stack" onSubmit={(event) => void handleSubmit(event)}>
          <Field label="Password">
            <input
              ref={passwordRef}
              id="download-licence-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={isSubmitting}
            />
          </Field>
          {error ? <ErrorBanner message={error} /> : null}
          <ButtonRow>
            <button type="button" className="secondary-button" onClick={clearAndClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={isSubmitting || !password}>
              {isSubmitting ? 'Verifying…' : 'Confirm and download'}
            </button>
          </ButtonRow>
        </form>
      </div>
    </div>
  );
}
