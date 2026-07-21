import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

const REDIRECT_TARGET = '/';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await login(email.trim(), password);
      if (import.meta.env.DEV) {
        console.info('[license-portal:login] redirecting', { redirectTarget: REDIRECT_TARGET });
      }
      navigate(REDIRECT_TARGET, { replace: true });
    } catch (submissionError) {
      let message = 'Login failed';
      let code: string | null = null;

      if (submissionError instanceof ApiError) {
        code = submissionError.code ?? null;
        message =
          code && !submissionError.message.startsWith(`${code}:`)
            ? `${code}: ${submissionError.message}`
            : submissionError.message;
      } else if (submissionError instanceof Error) {
        message = submissionError.message;
      }

      setError(message);
      if (import.meta.env.DEV) {
        console.info('[license-portal:login] failure', {
          reason: submissionError instanceof ApiError ? 'api-error' : 'exception',
          code,
          message,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-hero">
        <p className="eyebrow">Private administration</p>
        <h1>Patrol licence administration portal.</h1>
        <p>Issue TG1 licences, manage customers, record payments, and maintain an immutable audit trail.</p>
      </div>

      <form className="login-card" onSubmit={handleSubmit} noValidate={false}>
        <div>
          <h2>Administrator sign in</h2>
          <p className="muted-text">Authorised platform administrators only. No public registration.</p>
        </div>

        <label className="field" htmlFor="login-email">
          <span>Email</span>
          <input
            id="login-email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="username"
            required
            disabled={isSubmitting}
          />
        </label>

        <label className="field" htmlFor="login-password">
          <span>Password</span>
          <input
            id="login-password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            required
            disabled={isSubmitting}
          />
        </label>

        {error ? <p className="error-text" role="alert">{error}</p> : null}

        <button type="submit" className="primary-button" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
