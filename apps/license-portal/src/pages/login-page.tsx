import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

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
      navigate('/');
    } catch (submissionError) {
      if (submissionError instanceof ApiError) {
        setError(submissionError.message);
      } else {
        setError(submissionError instanceof Error ? submissionError.message : 'Login failed');
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

      <form className="login-card" onSubmit={handleSubmit}>
        <div>
          <h2>Administrator sign in</h2>
          <p className="muted-text">Authorised platform administrators only. No public registration.</p>
        </div>

        <label className="field">
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            required
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
