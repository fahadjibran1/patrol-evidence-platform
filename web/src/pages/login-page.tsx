import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { BuildLabel } from '../components/build-label';
import { beginDesktopAdminRecovery, isDesktopApp } from '../lib/desktop';
import { useAuth } from '../state/auth';
import type { DesktopBootstrapStatus } from '../types';
import { PRODUCT_INFO } from '../lib/product-info';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const desktop = isDesktopApp();

  useEffect(() => {
    if (!desktop) {
      setEmail('alpha.admin@patrol.local');
      setPassword('Password123!');
      return;
    }

    setPassword('');

    void apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status')
      .then((status) => {
        setSetupCompleted(status.setupCompleted === true);
        if (status.localAdminEmail?.trim()) {
          setEmail(status.localAdminEmail.trim());
        }
      })
      .catch(() => {
        setSetupCompleted(null);
      });
  }, [desktop]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setResetSuccess(null);

    try {
      await login(email.trim(), password);
      navigate('/');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasswordReset(): Promise<void> {
    setError(null);
    setResetSuccess(null);

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    const recoveryToken = await beginDesktopAdminRecovery();
    if (!recoveryToken) {
      return;
    }

    setIsResettingPassword(true);

    try {
      const result = await apiRequest<{ ok: true; email: string }>(
        '/desktop/bootstrap/reset-admin-password',
        {
          method: 'POST',
          headers: { 'X-PatrolSafe-Recovery-Token': recoveryToken },
          body: JSON.stringify({ newPassword, confirmPassword, confirmed: true }),
        },
      );
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowForgotPassword(false);
      setResetSuccess(`Password reset for ${result.email}. Sign in with your new password.`);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Password reset failed');
    } finally {
      setIsResettingPassword(false);
    }
  }

  function openRecoverySetup(): void {
    navigate('/desktop/setup', { state: { recoverySetup: true } });
  }

  return (
    <div className="login-shell">
      <div className="login-hero">
        <p className="eyebrow">{PRODUCT_INFO.productName}</p>
        <h1>{PRODUCT_INFO.tagline}</h1>
        <p>
          Turn everyday patrol photos into secure, organised and searchable site records while your guards continue
          using the WhatsApp workflow they already know.
        </p>
      </div>

      <form className="login-card" onSubmit={handleSubmit}>
        <div>
          <h2>Sign in</h2>
          <p>
            {desktop
              ? setupCompleted
                ? 'Sign in with the company admin account for this workstation.'
                : 'Complete first-run setup or sign in if an admin account already exists on this machine.'
              : 'Use a seeded company admin or guard account to test the full trial flow.'}
          </p>
          <BuildLabel />
        </div>

        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>

        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
            autoComplete="current-password"
          />
        </label>

        {error ? <p className="error-text">{error}</p> : null}
        {resetSuccess ? <p className="success-text">{resetSuccess}</p> : null}

        <button type="submit" className="primary-button" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>

        {desktop ? (
          <>
            <button type="button" className="text-link-button" onClick={() => setShowForgotPassword((current) => !current)}>
              Forgot password?
            </button>

            {showForgotPassword ? (
              <div className="login-recovery-panel">
                <p className="muted-text">
                  Set a new local admin password. Sites, patrol images, WhatsApp mappings, and the WhatsApp session are
                  not deleted.
                </p>
                <label>
                  New password
                  <input
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    type="password"
                    minLength={8}
                    required={showForgotPassword}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    type="password"
                    minLength={8}
                    required={showForgotPassword}
                    autoComplete="new-password"
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isResettingPassword}
                  onClick={() => void handlePasswordReset()}
                >
                  {isResettingPassword ? 'Resetting password...' : 'Reset local admin password'}
                </button>
              </div>
            ) : null}

            <button type="button" className="secondary-button" onClick={openRecoverySetup}>
              First-time setup / Reset workspace
            </button>
          </>
        ) : null}

        <div className="demo-accounts">
          <strong>{desktop ? 'Desktop sign-in' : 'Demo accounts'}</strong>
          {desktop ? (
            <p>
              {setupCompleted
                ? 'Your saved admin email is shown above. Enter your password to sign in.'
                : 'Use first-time setup to create the local admin account, or open setup again if you need to change workspace settings.'}
            </p>
          ) : (
            <>
              <p>`alpha.admin@patrol.local` / `Password123!`</p>
              <p>`alpha.guard@patrol.local` / `Password123!`</p>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
