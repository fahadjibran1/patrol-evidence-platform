import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiRequest, copyToClipboard, downloadTextFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDaysIso, formatUkDate, toIsoDate } from '../lib/dates';
import {
  ButtonRow,
  Card,
  ErrorBanner,
  Field,
  InfoBanner,
  LoadingState,
  PageHeader,
} from '../components/ui';
import type { LicenceDetail, RenewLicenceRequest, RenewLicenceResponse } from '../types';

export function RenewLicencePage(): JSX.Element {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { accessToken } = useAuth();
  const [licence, setLicence] = useState<LicenceDetail | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [maxDevices, setMaxDevices] = useState(3);
  const [notes, setNotes] = useState('');
  const [renewResult, setRenewResult] = useState<RenewLicenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!accessToken || !id) {
      return;
    }

    void apiRequest<LicenceDetail>(`/admin/licences/${id}`, {}, accessToken)
      .then((response) => {
        setLicence(response);
        const defaultStart = addDaysIso(response.expiresAt.slice(0, 10), 1);
        setStartsAt(defaultStart);
        setExpiresAt(addDaysIso(defaultStart, response.plan === 'MONTHLY' ? 30 : 365));
        setMaxDevices(response.maxDevices);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load licence');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken, id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const payload: RenewLicenceRequest = {
      startsAt: startsAt || undefined,
      expiresAt,
      maxDevices,
      notes: notes.trim() || undefined,
    };

    try {
      const response = await apiRequest<RenewLicenceResponse>(`/admin/licences/${id}/renew`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }, accessToken);
      setRenewResult(response);
    } catch (submissionError) {
      setError(submissionError instanceof ApiError ? submissionError.message : 'Renewal failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <LoadingState label="Loading licence…" />;
  }

  if (!licence) {
    return <ErrorBanner message={error ?? 'Licence not found.'} />;
  }

  if (renewResult) {
    return (
      <div className="page-stack">
        <PageHeader title="Licence renewed" subtitle={`New record ${renewResult.licence.licenseId}`} />
        <InfoBanner
          title="New TG1 key issued"
          message="Renewal creates a replacement licence record. Provide the new key to the customer securely."
        />
        <Card>
          <p className="key-display">{renewResult.licenseKey}</p>
          <ButtonRow>
            <button type="button" className="primary-button" onClick={() => void copyToClipboard(renewResult.licenseKey)}>
              Copy key
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => downloadTextFile(`${renewResult.licence.licenseId}.txt`, renewResult.licenseKey)}
            >
              Download .txt
            </button>
            <button type="button" className="secondary-button" onClick={() => navigate(`/licences/${renewResult.licence.id}`)}>
              View renewed licence
            </button>
          </ButtonRow>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={`Renew ${licence.licenseId}`}
        subtitle={`Current expiry ${formatUkDate(licence.expiresAt)}`}
      />

      <form className="page-stack" onSubmit={handleSubmit}>
        <Card>
          <div className="two-column-grid">
            <Field label="Start date (DD/MM/YYYY)" hint="Defaults to the day after current expiry.">
              <input
                defaultValue={formatUkDate(startsAt)}
                onBlur={(event) => {
                  try {
                    setStartsAt(toIsoDate(event.target.value));
                  } catch (validationError) {
                    setError(validationError instanceof Error ? validationError.message : 'Invalid start date');
                  }
                }}
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
                required
              />
            </Field>
            <Field label="Maximum devices">
              <input type="number" min={1} value={maxDevices} onChange={(event) => setMaxDevices(Number(event.target.value))} />
            </Field>
          </div>
          <Field label="Renewal notes">
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </Card>

        {error ? <ErrorBanner message={error} /> : null}

        <ButtonRow>
          <Link to={`/licences/${id}`} className="secondary-button">Cancel</Link>
          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? 'Renewing…' : 'Renew licence'}
          </button>
        </ButtonRow>
      </form>
    </div>
  );
}
