import { FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { ErrorBanner, InfoBanner } from '../components/ui';

export function ResetPasswordPage(): JSX.Element {
  const [params] = useSearchParams();
  const initialToken = useMemo(() => params.get('token') ?? '', [params]);
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await apiRequest('/customer/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setMessage('Password updated. You can sign in with your new password.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Reset failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={(event) => void onSubmit(event)}>
        <h2>Choose a new password</h2>
        {error ? <ErrorBanner message={error} /> : null}
        {message ? <InfoBanner title="Done" message={message} /> : null}
        <label>
          Reset token
          <input value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <label>
          New password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Update password'}</button>
        <p className="muted"><Link to="/login">Back to sign in</Link></p>
      </form>
    </div>
  );
}
