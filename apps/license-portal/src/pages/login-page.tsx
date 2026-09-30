import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { MfaChallengeResponse, MfaEnrollmentDetails } from '../types';

type Stage = 'PASSWORD' | 'ENROL' | 'VERIFY' | 'RECOVERY_CODES';

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [stage, setStage] = useState<Stage>('PASSWORD');
  const [challenge, setChallenge] = useState<MfaChallengeResponse | null>(null);
  const [enrollment, setEnrollment] = useState<MfaEnrollmentDetails | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function showError(value: unknown): void {
    if (value instanceof ApiError) {
      setError(value.code && !value.message.startsWith(value.code) ? value.code + ': ' + value.message : value.message);
    } else {
      setError(value instanceof Error ? value.message : 'Sign in failed.');
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await auth.login(email.trim(), password);
      if (!('mfaRequired' in result)) return navigate('/', { replace: true });
      setChallenge(result);
      if (!result.enrollmentRequired) return setStage('VERIFY');
      const details = await auth.startMfaEnrollment(result.challengeToken);
      setEnrollment(details);
      setQrCode(await QRCode.toDataURL(details.otpauthUri, { margin: 1, width: 240 }));
      setStage('ENROL');
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  async function submitMfa(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      if (stage === 'ENROL') {
        const result = await auth.confirmMfaEnrollment(challenge.challengeToken, code);
        setRecoveryCodes(result.recoveryCodes);
        setEnrollment(null);
        setQrCode(null);
        setStage('RECOVERY_CODES');
      } else {
        await auth.verifyMfaLogin(challenge.challengeToken, useRecovery ? { recoveryCode: recoveryCode.trim() } : { code });
        navigate('/', { replace: true });
      }
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy(false);
    }
  }

  const otpField = <label className="field"><span>Authenticator code</span><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></label>;

  return <div className="login-shell">
    <div className="login-hero"><p className="eyebrow">Private administration</p><h1>Patrol licence administration portal.</h1><p>Authorised operators only. Multi-factor authentication protects production access.</p></div>
    {stage === 'PASSWORD' ? <form className="login-card" onSubmit={(event) => void submitPassword(event)}>
      <div><h2>Administrator sign in</h2><p className="muted-text">No public registration.</p></div>
      <label className="field" htmlFor="login-email"><span>Email</span><input id="login-email" name="email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required /></label>
      <label className="field" htmlFor="login-password"><span>Password</span><input id="login-password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form> : null}
    {stage === 'ENROL' && enrollment ? <form className="login-card" onSubmit={(event) => void submitMfa(event)}>
      <div><h2>Set up multi-factor authentication</h2><p className="muted-text">Scan the QR code with your authenticator app, then enter its six-digit code. The setup secret is shown only during enrolment.</p></div>
      {qrCode ? <img src={qrCode} alt="Authenticator enrolment QR code" width="240" height="240" /> : null}
      <details><summary>Cannot scan the QR code?</summary><p>Enter this setup key manually:</p><code>{enrollment.secret}</code></details>
      {otpField}{error ? <p className="error-text" role="alert">{error}</p> : null}
      <button type="submit" className="primary-button" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Enable MFA'}</button>
    </form> : null}
    {stage === 'VERIFY' ? <form className="login-card" onSubmit={(event) => void submitMfa(event)}>
      <div><h2>Multi-factor verification</h2><p className="muted-text">Enter a current authenticator code to continue.</p></div>
      {useRecovery ? <label className="field"><span>Recovery code</span><input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} autoComplete="one-time-code" required /></label> : otpField}
      <button type="button" className="secondary-button" onClick={() => { setUseRecovery((current) => !current); setError(null); }}>{useRecovery ? 'Use authenticator code' : 'Use a recovery code'}</button>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Verifying…' : 'Verify and sign in'}</button>
    </form> : null}
    {stage === 'RECOVERY_CODES' ? <section className="login-card">
      <div><h2>Save your recovery codes</h2><p className="muted-text">Each code works once. Store them in your approved password manager. They cannot be displayed again.</p></div>
      <ul>{recoveryCodes.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
      <button type="button" className="primary-button" onClick={() => navigate('/', { replace: true })}>I have saved these codes</button>
    </section> : null}
  </div>;
}
