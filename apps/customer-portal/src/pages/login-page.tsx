import { FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ErrorBanner } from '../components/ui';

export function LoginPage(): JSX.Element {
  const { accessToken, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (accessToken) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password, rememberMe);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <section className="login-hero">
        <p className="eyebrow">PatrolSafe by S4</p>
        <h1>Customer Portal</h1>
        <p>Sign in to manage your organisation licences, team members, and downloads.</p>
      </section>
      <form className="login-card" onSubmit={(event) => void onSubmit(event)}>
        <h2>Sign in</h2>
        {error ? <ErrorBanner message={error} /> : null}
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
          Remember me
        </label>
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted">
          <Link to="/forgot-password">Forgot password?</Link>
          {' · '}
          <Link to="/accept-invitation">Accept invitation</Link>
        </p>
      </form>
    </div>
  );
}
