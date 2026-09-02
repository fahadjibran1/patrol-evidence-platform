import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE_OPTIONS } from '../lib/permissions';
import {
  Card,
  EmptyState,
  ErrorBanner,
  InfoBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { CustomerRole, OrgInvitation } from '../types';

export function InvitationsPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<OrgInvitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CustomerRole>('VIEWER');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function load(): Promise<void> {
    if (!accessToken) return;
    const response = await apiRequest<{ items: OrgInvitation[] }>('/customer/invitations', {}, accessToken);
    setItems(response.items);
  }

  useEffect(() => {
    setIsLoading(true);
    void load()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load invitations'))
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  async function onInvite(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!accessToken) return;
    setError(null);
    setInfo(null);
    try {
      const created = await apiRequest<{ invitationToken?: string }>('/customer/invitations', {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      }, accessToken);
      setEmail('');
      setInfo(
        created.invitationToken
          ? `Invitation created. Dev token: ${created.invitationToken}`
          : 'Invitation created.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    }
  }

  async function cancel(id: string): Promise<void> {
    if (!accessToken) return;
    await apiRequest(`/customer/invitations/${id}/cancel`, { method: 'POST', body: '{}' }, accessToken);
    await load();
  }

  async function resend(id: string): Promise<void> {
    if (!accessToken) return;
    const result = await apiRequest<{ invitationToken?: string }>(
      `/customer/invitations/${id}/resend`,
      { method: 'POST', body: '{}' },
      accessToken,
    );
    setInfo(result.invitationToken ? `Resent. Dev token: ${result.invitationToken}` : 'Invitation resent.');
    await load();
  }

  return (
    <div className="page-stack">
      <PageHeader title="Invitations" subtitle="Invite users with a role. Tokens expire automatically after 7 days." />
      {error ? <ErrorBanner message={error} /> : null}
      {info ? <InfoBanner title="Invitation" message={info} /> : null}
      <Card>
        <h3>Invite user</h3>
        <form className="form-grid" onSubmit={(event) => void onInvite(event)}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as CustomerRole)}>
              {ROLE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <button type="submit">Send invitation</button>
        </form>
      </Card>
      {isLoading ? <LoadingState label="Loading invitations…" /> : null}
      {!isLoading && items.length === 0 ? (
        <EmptyState title="No invitations" description="Invite history will appear here." />
      ) : null}
      {!isLoading && items.length > 0 ? (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>{invitation.email}</td>
                    <td>{invitation.role}</td>
                    <td><StatusBadge value={invitation.status} /></td>
                    <td>{new Date(invitation.expiresAt).toLocaleString()}</td>
                    <td className="button-row">
                      {invitation.status === 'PENDING' || invitation.status === 'EXPIRED' ? (
                        <button type="button" className="secondary-button" onClick={() => void resend(invitation.id)}>Resend</button>
                      ) : null}
                      {invitation.status === 'PENDING' ? (
                        <button type="button" className="secondary-button" onClick={() => void cancel(invitation.id)}>Cancel</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
