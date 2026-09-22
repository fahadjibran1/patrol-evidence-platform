import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import {
  clearCommercialPurchaseSession,
  isDesktopApp,
  openCommercialPurchase,
  readCommercialPurchaseSession,
  writeCommercialPurchaseSession,
} from '../lib/desktop';
import { LICENCE_IMPORT_ACCEPT, readLocalLicenceFile } from '../lib/licence-file-import';
import { useAuth } from '../state/auth';
import { useEntitlement } from '../state/entitlement';
import type { LicenseStatusResponse } from '../types';
import { Card, PageHeader, StatusBadge } from '../components/ui';
import { formatPatrolDate, formatPatrolDateTime } from '../lib/patrol-time';

const SUPPLIER_CONTACT = 'mailto:support@sfour.co.uk?subject=PatrolSafe%20by%20S4%20Licence';
const PUBLIC_REQUEST_PLAN = 'annual' as const;
const PURCHASE_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type PurchaseStatus = 'AWAITING_PAYMENT' | 'AWAITING_APPROVAL' | 'PREPARING' | 'READY' | 'DELIVERY_PROBLEM';

interface PurchaseSession {
  requestId: string;
  clientNonce: string;
  previousLicenceId: string | null;
  purchaseReference?: string;
  purchaseUrl?: string;
  referenceExpiresAt: string;
}

interface PurchaseStartedResponse {
  requestId: string;
  publicOrderId: string;
  purchaseReference: string;
  referenceExpiresAt: string;
  purchaseUrl: string;
  status: 'PURCHASE_STARTED';
}

interface PurchaseStatusResponse {
  status: PurchaseStatus;
  message: string;
}

function nonce(): string {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function parsePurchaseSession(raw: string | null): PurchaseSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PurchaseSession;
    if (!value.requestId || !value.clientNonce || !Number.isFinite(Date.parse(value.referenceExpiresAt))) return null;
    if (value.purchaseReference && !PURCHASE_REFERENCE_PATTERN.test(value.purchaseReference)) return null;
    if (Date.parse(value.referenceExpiresAt) <= Date.now()) return null;
    return value;
  } catch {
    return null;
  }
}

export function LicensePage(): JSX.Element {
  const navigate = useNavigate();
  const { token } = useAuth();
  const { licenceStatus: status, bootstrapStatus, reconcileEntitlement } = useEntitlement();
  const desktop = isDesktopApp();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [purchaseSession, setPurchaseSession] = useState<PurchaseSession | null>(null);
  const [purchaseStatus, setPurchaseStatus] = useState<PurchaseStatusResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const companyName = status?.companyName ?? bootstrapStatus?.companyName ?? '';

  useEffect(() => {
    let active = true;
    void readCommercialPurchaseSession().then(async (raw) => {
      const session = parsePurchaseSession(raw);
      if (!active) return;
      setPurchaseSession(session);
      if (!session && raw) await clearCommercialPurchaseSession();
    });
    return () => { active = false; };
  }, []);

  const isTrial = status?.mode === 'trial' || status?.plan === 'trial' || status?.uiState === 'Trial Active';
  const isCommercial = status?.mode === 'commercial';
  const isLicensed = status?.uiState === 'Licensed' || (status?.status === 'ACTIVE' && !isTrial);
  const isExpired = status?.uiState === 'Expired' || status?.status === 'EXPIRED';
  const isExpiring = isLicensed && isCommercial && status?.expiresAt !== null && (status?.daysRemaining ?? 9999) <= 90;
  const canRenew = isCommercial && (isExpiring || isExpired);
  const stateLabel = isTrial && !isExpired
    ? 'TRIAL'
    : isExpired
      ? 'EXPIRED'
      : isExpiring
        ? 'EXPIRING'
        : isLicensed
          ? 'LICENSED'
          : 'ACTIVATION REQUIRED';
  const expiryLabel = status?.expiresAt
    ? (isTrial ? formatPatrolDateTime(status.expiresAt) : formatPatrolDate(status.expiresAt))
    : isLicensed ? 'No expiry' : 'Not available';
  const trialWarning = useMemo(() => {
    if (!isTrial || isExpired) return null;
    const remaining = status?.daysRemaining ?? 0;
    if (remaining <= 1) return 'Your trial expires within 1 day.';
    if (remaining <= 3) return 'Your trial expires within 3 days.';
    if (remaining <= 7) return 'Your trial expires within 7 days.';
    return null;
  }, [isExpired, isTrial, status?.daysRemaining]);
  const commercialWarning = useMemo(() => {
    if (!isCommercial || isExpired || !isLicensed) return null;
    const remaining = status?.daysRemaining ?? 9999;
    if (remaining <= 7) return 'Your annual licence expires within 7 days. Renew now to avoid a monitoring interruption.';
    if (remaining <= 30) return 'Your annual licence expires within 30 days. Renewal is available.';
    if (remaining <= 90) return 'Your annual licence expires within 90 days. Renewal is available.';
    return null;
  }, [isCommercial, isExpired, isLicensed, status?.daysRemaining]);

  async function persistSession(session: PurchaseSession): Promise<void> {
    if (!(await writeCommercialPurchaseSession(JSON.stringify(session)))) throw new Error('Purchase recovery storage is unavailable.');
    setPurchaseSession(session);
  }

  async function handleOnlinePurchase(): Promise<void> {
    if (!token || !companyName.trim()) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const currentSession = purchaseSession && Date.parse(purchaseSession.referenceExpiresAt) > Date.now()
        ? purchaseSession
        : null;
      if (!currentSession && purchaseSession) {
        await clearCommercialPurchaseSession();
        setPurchaseSession(null);
      }
      if (currentSession?.purchaseUrl && currentSession.purchaseReference) {
        if (!(await openCommercialPurchase(currentSession.purchaseUrl))) throw new Error('Browser handoff unavailable');
        setSuccess('Purchase started. Complete payment in your browser, then check licence status here.');
        return;
      }
      const pending: PurchaseSession = currentSession ?? {
        requestId: window.crypto.randomUUID(),
        clientNonce: nonce(),
        previousLicenceId: canRenew ? status?.licenseId ?? null : null,
        referenceExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
      await persistSession(pending);
      const result = await apiRequest<PurchaseStartedResponse>(
        '/license/commercial/purchase',
        { method: 'POST', body: JSON.stringify({ requestId: pending.requestId, clientNonce: pending.clientNonce, previousLicenceId: pending.previousLicenceId }) },
        token,
      );
      const active: PurchaseSession = { ...pending, purchaseReference: result.purchaseReference, purchaseUrl: result.purchaseUrl, referenceExpiresAt: result.referenceExpiresAt };
      await persistSession(active);
      if (!(await openCommercialPurchase(result.purchaseUrl))) throw new Error('Browser handoff unavailable');
      setPurchaseStatus({ status: 'AWAITING_PAYMENT', message: 'Awaiting payment' });
      setSuccess('Purchase started. Complete payment in your browser, then check licence status here.');
    } catch {
      setError('Online purchasing is currently unavailable. Your trial or existing licence is unchanged. You can retry or use Manual / Offline activation.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCheckPurchaseStatus(): Promise<void> {
    if (!token || !purchaseSession?.purchaseReference) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await apiRequest<PurchaseStatusResponse>(
        '/license/commercial/status',
        { method: 'POST', body: JSON.stringify({ purchaseReference: purchaseSession.purchaseReference }) },
        token,
      );
      setPurchaseStatus(result);
    } catch {
      setPurchaseStatus({ status: 'DELIVERY_PROBLEM', message: 'Purchase status unavailable — retry or contact PatrolSafe support' });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleExportRequest(): Promise<void> {
    setIsSubmitting(true); setError(null); setSuccess(null);
    try {
      const result = await apiRequest<{ fileName: string; contents: string }>('/license/request-file', { method: 'POST', body: JSON.stringify({ companyName: companyName.trim(), requestedPlan: PUBLIC_REQUEST_PLAN }) }, token ?? undefined);
      const blob = new Blob([result.contents], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.fileName; anchor.click(); URL.revokeObjectURL(url);
      setSuccess('Licence request created. Send the downloaded file to PatrolSafe support.');
    } catch { setError('The licence request could not be created. Check company setup and try again.'); }
    finally { setIsSubmitting(false); }
  }

  async function handleImportAndActivate(raw: string): Promise<void> {
    setIsSubmitting(true); setError(null); setSuccess(null);
    try {
      const next = await apiRequest<LicenseStatusResponse>('/license/import', { method: 'POST', body: JSON.stringify({ licenceFileContents: raw }) }, token ?? undefined);
      await reconcileEntitlement(next);
      await clearCommercialPurchaseSession();
      setPurchaseSession(null); setPurchaseStatus(null);
      setSuccess(next.uiState === 'Licensed' ? 'PatrolSafe is now activated. No restart is required.' : next.message);
    } catch { setError('That licence file could not be activated. Confirm it belongs to this workstation and try again.'); }
    finally { setIsSubmitting(false); }
  }

  async function handleDeactivate(): Promise<void> {
    if (!window.confirm('Deactivate the licence on this workstation? Existing sites and evidence will be kept.')) return;
    setIsSubmitting(true); setError(null); setSuccess(null);
    try {
      const next = await apiRequest<LicenseStatusResponse>('/license/deactivate', { method: 'POST', body: '{}' }, token ?? undefined);
      await reconcileEntitlement(next); setSuccess('Licence deactivated. Existing data was preserved.');
    } catch { setError('The licence could not be deactivated. No company data was changed.'); }
    finally { setIsSubmitting(false); }
  }

  async function handleCopyInstallationId(): Promise<void> {
    if (!status?.installationId) return;
    try { await navigator.clipboard.writeText(status.installationId); setCopyMessage('Installation ID copied.'); }
    catch { setCopyMessage('Select the installation ID and copy it manually.'); }
  }

  async function handleImportLicenceFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const result = await readLocalLicenceFile(file).catch(() => ({ ok: false as const, error: 'The selected file could not be read.' }));
    if (!result.ok) { setError(result.error); return; }
    await handleImportAndActivate(result.key);
  }

  function handleManualImport(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = (event.currentTarget.elements.namedItem('licenceJson') as HTMLTextAreaElement | null)?.value;
    if (!value?.trim()) { setError('Paste the licence file contents or choose a licence file.'); return; }
    void handleImportAndActivate(value.trim());
  }

  if (!desktop) return <div className="page-shell narrow"><h1>Licence</h1><p>Licensing is managed in the installed PatrolSafe app.</p></div>;

  return (
    <div className="page-stack licence-page">
      <PageHeader eyebrow="Settings" title="PatrolSafe Licence" subtitle="Your evidence remains accessible if a trial or licence expires." />
      {error ? <div className="banner banner-danger" role="alert">{error}</div> : null}
      {success ? <div className="banner banner-success" role="status">{success}</div> : null}
      {trialWarning ? <div className="banner" role="status">{trialWarning}</div> : null}
      {commercialWarning ? <div className="banner" role="status">{commercialWarning}</div> : null}
      <Card className={`licence-hero${isExpired ? ' licence-hero-danger' : ''}`}>
        <div className="licence-hero-copy">
          <StatusBadge value={stateLabel} />
          <h3>{isTrial && !isExpired ? 'PatrolSafe Trial' : isExpired && isCommercial ? 'Licence expired' : stateLabel}</h3>
          <p className="licence-lead">{isTrial && !isExpired ? `${status?.daysRemaining ?? '—'} day${status?.daysRemaining === 1 ? '' : 's'} remaining` : isLicensed ? `Annual licence${isExpiring ? ' — renewal available' : ''}` : isExpired ? 'Monitoring and new evidence are paused. Existing evidence, backup and support remain available.' : 'Activate PatrolSafe to continue live patrol monitoring.'}</p>
          {status?.expiresAt ? <p className="muted-text">Expires {expiryLabel}</p> : null}
        </div>
        <dl className="licence-summary"><div><dt>Company</dt><dd>{companyName || 'Not set'}</dd></div><div><dt>Expires</dt><dd>{expiryLabel}</dd></div><div><dt>Plan</dt><dd>{isTrial ? '30 days from first launch' : status?.plan ? 'Annual' : 'Not activated'}</dd></div></dl>
      </Card>

      <div className="settings-grid">
        <Card className="action-card licence-purchase-card">
          <p className="eyebrow">PatrolSafe Annual Licence</p><h3>{canRenew ? 'Renew licence' : 'Buy annual licence'}</h3>
          <p className="licence-price">£299 <span>+ VAT where applicable</span></p>
          <ul className="plain-list"><li>1 Windows workstation</li><li>12-month licence</li><li>Manual annual renewal — no automatic charge</li></ul>
          <button type="button" className="primary-button" disabled={isSubmitting || companyName.trim().length < 2} onClick={() => void handleOnlinePurchase()}>{isSubmitting ? 'Please wait…' : canRenew ? 'Renew licence' : 'Buy annual licence'}</button>
          {purchaseSession?.purchaseReference ? <div className="purchase-status-panel"><strong>Purchase started</strong><p>{purchaseStatus?.message ?? 'Complete payment in your browser. PatrolSafe will not activate until you import the supplied licence.'}</p><button type="button" className="secondary-button" disabled={isSubmitting} onClick={() => void handleCheckPurchaseStatus()}>Check licence status</button></div> : null}
        </Card>
        <Card className="action-card">
          <p className="eyebrow">Already purchased?</p><h3>Activate supplied licence</h3><p className="muted-text">Choose the PatrolSafe .tglic file supplied for this workstation.</p>
          <input ref={fileInputRef} type="file" accept={LICENCE_IMPORT_ACCEPT} hidden onChange={(event) => void handleImportLicenceFile(event)} />
          <button type="button" className="primary-button" disabled={isSubmitting} onClick={() => fileInputRef.current?.click()}>{isSubmitting ? 'Checking licence…' : 'Activate supplied licence (.tglic)'}</button>
          <a className="secondary-button" href={SUPPLIER_CONTACT}>Contact support</a>
        </Card>
      </div>

      <Card><details className="customer-details"><summary>Manual / Offline activation</summary><p className="muted-text">Use this option if instructed by PatrolSafe support or if online purchase is unavailable.</p><div className="settings-grid"><div className="action-card"><h3>Step 1</h3><p>Create a workstation-bound request file.</p><button type="button" className="secondary-button" disabled={isSubmitting || companyName.trim().length < 2} onClick={() => void handleExportRequest()}>Create licence request (.tgreq)</button></div><div className="action-card"><h3>Step 2</h3><p>Activate the supplied signed licence.</p><button type="button" className="secondary-button" disabled={isSubmitting} onClick={() => fileInputRef.current?.click()}>Activate supplied licence (.tglic)</button></div></div></details></Card>
      <Card><details className="customer-details"><summary>Licence details</summary><dl className="customer-detail-list"><div><dt>Installation ID</dt><dd className="breakable-value">{status?.installationId ?? 'Preparing…'}</dd></div><div><dt>Licence ID</dt><dd>{status?.licenseId ?? 'Not activated'}</dd></div><div><dt>Version</dt><dd>{status?.appVersion ?? '—'}{status?.buildId ? ` · build ${status.buildId}` : ''}</dd></div></dl><div className="button-row"><button type="button" className="secondary-button" onClick={() => void handleCopyInstallationId()}>Copy installation ID</button><button type="button" className="secondary-button" disabled={isSubmitting || status?.mode !== 'commercial'} onClick={() => void handleDeactivate()}>Deactivate licence</button><button type="button" className="secondary-button" onClick={() => navigate('/settings/support')}>Open Support</button></div>{copyMessage ? <p className="muted-text">{copyMessage}</p> : null}<details className="advanced-inline-details"><summary>Advanced licence import</summary><form className="stack-form" onSubmit={handleManualImport}><label>Paste licence file contents<textarea name="licenceJson" rows={5} /></label><button type="submit" className="secondary-button" disabled={isSubmitting}>Import pasted licence</button></form></details></details></Card>
      {status?.status === 'ACTIVE' && token ? <div className="button-row"><button type="button" className="primary-button" onClick={() => navigate('/')}>Continue to dashboard</button></div> : null}
    </div>
  );
}
