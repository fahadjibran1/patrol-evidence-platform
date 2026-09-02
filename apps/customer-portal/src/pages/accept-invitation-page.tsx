import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBanner } from '../components/ui';
import type { CustomerLoginResponse } from '../types';

export function AcceptInvitationPage(): JSX.Element {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [params] = useSearchParams();
  const initialToken = useMemo(() => params.get('token') ?? '', [params]);
  const [token, setToken] = useState(initialToken);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await apiRequest<CustomerLoginResponse>('/customer/auth/accept-invitation', {
        method: 'POST',
        body: JSON.stringify({ token, displayName, password, phone: phone || undefined }),
      });
      // Persist via login path isn't available (already authenticated). Store by calling login is wrong.
      // Re-login with new credentials to establish portal session cleanly.
      await login(response.customer.email, password);
      navigate('/');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Invitation acceptance failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={(event) => void onSubmit(event)}>
        <h2>Accept invitation</h2>
        {error ? <ErrorBanner message={error} /> : null}
        <label>
          Invitation token
          <input value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </label>
        <label>
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Creating account…' : 'Join organisation'}</button>
        <p className="muted"><Link to="/login">Back to sign in</Link></p>
      </form>
    </div>
  );
}
