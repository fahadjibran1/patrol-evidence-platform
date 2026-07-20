import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatUkDateTime } from '../lib/dates';
import {
  Card,
  DataTable,
  ErrorBanner,
  Field,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { AdminRole, AdminUser, PaginatedResponse } from '../types';

export function AdminsPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AdminRole>('ADMIN');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadAdmins(): Promise<void> {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiRequest<PaginatedResponse<AdminUser>>('/admin/admins?page=1&pageSize=100', {}, accessToken);
      setAdmins(response.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load admin users');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAdmins();
  }, [accessToken]);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await apiRequest('/admin/admins', {
        method: 'POST',
        body: JSON.stringify({ email, displayName, password, role }),
      }, accessToken);
      setEmail('');
      setDisplayName('');
      setPassword('');
      await loadAdmins();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Failed to create admin');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="Admin users" subtitle="SUPER_ADMIN only. Manage portal administrator accounts." />

      <Card>
        <h3>Create administrator</h3>
        <form className="two-column-grid" onSubmit={handleCreate}>
          <Field label="Email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>
          <Field label="Display name"><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></Field>
          <Field label="Temporary password"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} /></Field>
          <Field label="Role">
            <select value={role} onChange={(event) => setRole(event.target.value as AdminRole)}>
              <option value="ADMIN">ADMIN</option>
              <option value="SUPPORT">SUPPORT</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
            </select>
          </Field>
          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create admin'}
          </button>
        </form>
      </Card>

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading admin users…" /> : (
        <Card>
          <DataTable
            caption="Admin users"
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'email', label: 'Email' },
              { key: 'role', label: 'Role' },
              { key: 'active', label: 'Active' },
              { key: 'lastLogin', label: 'Last login' },
            ]}
            rows={admins.map((admin) => ({
              id: admin.id,
              cells: {
                name: admin.displayName,
                email: admin.email,
                role: admin.role.replace(/_/g, ' '),
                active: <StatusBadge value={admin.isActive ? 'ACTIVE' : 'INACTIVE'} />,
                lastLogin: formatUkDateTime(admin.lastLoginAt),
              },
            }))}
          />
        </Card>
      )}
    </div>
  );
}
