import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Card,
  ErrorBanner,
  InfoBanner,
  LoadingState,
  PageHeader,
} from '../components/ui';
import type { CustomerProfile } from '../types';

export function ProfilePage(): JSX.Element {
  const { accessToken } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [notifyLicence, setNotifyLicence] = useState(true);
  const [notifyGeneral, setNotifyGeneral] = useState(true);
  const [notifySystem, setNotifySystem] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    if (!accessToken) return;
    setIsLoading(true);
    void apiRequest<CustomerProfile>('/customer/profile', {}, accessToken)
      .then((response) => {
        setProfile(response);
        setDisplayName(response.user.displayName);
        setPhone(response.user.phone ?? '');
        setNotifyLicence(response.user.notificationPreferences.licence);
        setNotifyGeneral(response.user.notificationPreferences.general);
        setNotifySystem(response.user.notificationPreferences.system);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load profile'))
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!accessToken) return;
    setError(null);
    setSuccess(null);
    try {
      const updated = await apiRequest<CustomerProfile>('/customer/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName,
          phone,
          notifyLicence,
          notifyGeneral,
          notifySystem,
        }),
      }, accessToken);
      setProfile(updated);
      setSuccess('Profile updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function onChangePassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!accessToken) return;
    setError(null);
    setSuccess(null);
    try {
      await apiRequest('/customer/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }, accessToken);
      setCurrentPassword('');
      setNewPassword('');
      setSuccess('Password changed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed');
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="Profile" subtitle="Manage your name, phone, notification preferences, and password." />
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <InfoBanner title="Saved" message={success} /> : null}
      {isLoading ? <LoadingState /> : null}
      {!isLoading && profile ? (
        <>
          <Card>
            <h3>Your account</h3>
            <div className="detail-grid">
              <div className="detail-item"><span>Email</span><strong>{profile.user.email}</strong></div>
              <div className="detail-item"><span>Role</span><strong>{profile.user.role}</strong></div>
              <div className="detail-item"><span>Email verified</span><strong>{profile.user.emailVerified ? 'Yes' : 'No'}</strong></div>
            </div>
            <form className="form-grid" onSubmit={(event) => void onSubmit(event)} style={{ marginTop: '1rem' }}>
              <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
              <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
              <fieldset>
                <legend>Notification preferences</legend>
                <label className="checkbox-row"><input type="checkbox" checked={notifyLicence} onChange={(e) => setNotifyLicence(e.target.checked)} />Licence</label>
                <label className="checkbox-row"><input type="checkbox" checked={notifyGeneral} onChange={(e) => setNotifyGeneral(e.target.checked)} />General</label>
                <label className="checkbox-row"><input type="checkbox" checked={notifySystem} onChange={(e) => setNotifySystem(e.target.checked)} />System</label>
              </fieldset>
              <button type="submit">Save profile</button>
            </form>
          </Card>
          <Card>
            <h3>Change password</h3>
            <form className="form-grid" onSubmit={(event) => void onChangePassword(event)}>
              <label>Current password<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required minLength={8} /></label>
              <label>New password<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} /></label>
              <button type="submit">Update password</button>
            </form>
          </Card>
        </>
      ) : null}
    </div>
  );
}
