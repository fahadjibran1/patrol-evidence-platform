import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE_OPTIONS } from '../lib/permissions';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { CustomerRole, OrgMember } from '../types';

export function UsersPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<OrgMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function load(): Promise<void> {
    if (!accessToken) return;
    const response = await apiRequest<{ items: OrgMember[] }>('/customer/members', {}, accessToken);
    setItems(response.items);
  }

  useEffect(() => {
    setIsLoading(true);
    void load()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load users'))
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  async function changeRole(memberId: string, role: CustomerRole): Promise<void> {
    if (!accessToken) return;
    setError(null);
    try {
      await apiRequest(`/customer/members/${memberId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }, accessToken);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role update failed');
    }
  }

  async function setActive(memberId: string, isActive: boolean): Promise<void> {
    if (!accessToken) return;
    setError(null);
    try {
      await apiRequest(`/customer/members/${memberId}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      }, accessToken);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function removeMember(memberId: string): Promise<void> {
    if (!accessToken) return;
    setError(null);
    try {
      await apiRequest(`/customer/members/${memberId}`, { method: 'DELETE' }, accessToken);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="Users" subtitle="Organisation members and roles. The last Owner cannot be removed." />
      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading users…" /> : null}
      {!isLoading && items.length === 0 ? (
        <EmptyState title="No users" description="Invite teammates from the Invitations page." />
      ) : null}
      {!isLoading && items.length > 0 ? (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((member) => (
                  <tr key={member.id}>
                    <td>{member.displayName}</td>
                    <td>{member.email}</td>
                    <td>
                      <select
                        value={member.role}
                        onChange={(event) => void changeRole(member.id, event.target.value as CustomerRole)}
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                    </td>
                    <td><StatusBadge value={member.isActive ? 'ACTIVE' : 'SUSPENDED'} /></td>
                    <td className="button-row">
                      <button type="button" className="secondary-button" onClick={() => void setActive(member.id, !member.isActive)}>
                        {member.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button type="button" className="secondary-button" onClick={() => void removeMember(member.id)}>
                        Remove
                      </button>
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
