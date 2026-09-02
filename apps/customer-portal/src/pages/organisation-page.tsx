import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canManageOrg } from '../lib/permissions';
import {
  Card,
  ErrorBanner,
  InfoBanner,
  LoadingState,
  PageHeader,
} from '../components/ui';
import type { CustomerProfile } from '../types';

export function OrganisationPage(): JSX.Element {
  const { accessToken, customer } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const canEdit = canManageOrg(customer);

  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [technicalContactName, setTechnicalContactName] = useState('');
  const [technicalContactEmail, setTechnicalContactEmail] = useState('');
  const [technicalContactPhone, setTechnicalContactPhone] = useState('');

  useEffect(() => {
    if (!accessToken) return;
    setIsLoading(true);
    void apiRequest<CustomerProfile>('/customer/organisation', {}, accessToken)
      .then((response) => {
        setProfile(response);
        setContactName(response.company.contactName ?? '');
        setPhone(response.company.phone ?? '');
        setTechnicalContactName(response.company.technicalContactName ?? '');
        setTechnicalContactEmail(response.company.technicalContactEmail ?? '');
        setTechnicalContactPhone(response.company.technicalContactPhone ?? '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load organisation'))
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!accessToken || !canEdit) return;
    setError(null);
    setSuccess(null);
    try {
      const updated = await apiRequest<CustomerProfile>('/customer/organisation', {
        method: 'PATCH',
        body: JSON.stringify({
          contactName,
          phone,
          technicalContactName,
          technicalContactEmail,
          technicalContactPhone,
        }),
      }, accessToken);
      setProfile(updated);
      setSuccess('Organisation details updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="Organisation" subtitle="Company contacts and technical contacts. Billing remains read-only." />
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <InfoBanner title="Saved" message={success} /> : null}
      {isLoading ? <LoadingState /> : null}
      {!isLoading && profile ? (
        <>
          <Card>
            <h3>{profile.company.companyName}</h3>
            <div className="detail-grid">
              <div className="detail-item"><span>Status</span><strong>{profile.company.status}</strong></div>
              <div className="detail-item"><span>Company email</span><strong>{profile.company.email}</strong></div>
            </div>
          </Card>
          <Card>
            <h3>Contacts</h3>
            <form className="form-grid" onSubmit={(event) => void onSubmit(event)}>
              <label>Contact name<input disabled={!canEdit} value={contactName} onChange={(e) => setContactName(e.target.value)} /></label>
              <label>Phone<input disabled={!canEdit} value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
              <label>Technical contact name<input disabled={!canEdit} value={technicalContactName} onChange={(e) => setTechnicalContactName(e.target.value)} /></label>
              <label>Technical contact email<input disabled={!canEdit} type="email" value={technicalContactEmail} onChange={(e) => setTechnicalContactEmail(e.target.value)} /></label>
              <label>Technical contact phone<input disabled={!canEdit} value={technicalContactPhone} onChange={(e) => setTechnicalContactPhone(e.target.value)} /></label>
              {canEdit ? <button type="submit">Save organisation</button> : null}
            </form>
          </Card>
          <Card>
            <h3>Billing (read-only)</h3>
            <div className="detail-grid">
              <div className="detail-item"><span>Address</span><strong>{profile.billing.addressLine1 ?? '—'}</strong></div>
              <div className="detail-item"><span>City</span><strong>{profile.billing.city ?? '—'}</strong></div>
              <div className="detail-item"><span>Postcode</span><strong>{profile.billing.postcode ?? '—'}</strong></div>
              <div className="detail-item"><span>Country</span><strong>{profile.billing.country}</strong></div>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
