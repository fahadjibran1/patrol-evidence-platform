import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canApproveCommercialIssuance, canViewCommercialApprovals } from '../lib/roles';
import type { CommercialApprovalReview } from '../types';

type Decision = 'approve' | 'hold' | 'reject' | 'release-hold';

export function CommercialApprovalsPage(): JSX.Element {
  const { admin, accessToken } = useAuth();
  const [orders, setOrders] = useState<CommercialApprovalReview[]>([]);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || !canViewCommercialApprovals(admin?.role)) return;
    setOrders(await apiRequest<CommercialApprovalReview[]>('/admin/commercial/approvals', {}, accessToken));
  }, [accessToken, admin?.role]);

  useEffect(() => { void load().catch((error: Error) => setMessage(error.message)); }, [load]);

  async function decide(order: CommercialApprovalReview, decision: Decision): Promise<void> {
    if (!accessToken || !password) return;
    setBusy(order.publicOrderId);
    setMessage(null);
    try {
      const stepUp = await apiRequest<{ stepUpToken: string }>('/admin/commercial/step-up', { method: 'POST', body: JSON.stringify({ password }) }, accessToken);
      await apiRequest(`/admin/commercial/approvals/${encodeURIComponent(order.publicOrderId)}/${decision}`, {
        method: 'POST',
        headers: { 'X-Commercial-Step-Up': stepUp.stepUpToken },
        body: decision === 'approve' ? '{}' : JSON.stringify({ reason }),
      }, accessToken);
      setPassword('');
      setReason('');
      setMessage(decision === 'approve' ? 'Issuance queued. No customer delivery has occurred.' : 'Decision recorded.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Commercial decision failed.');
    } finally {
      setBusy(null);
    }
  }

  if (!canViewCommercialApprovals(admin?.role)) return <section><h2>Commercial approvals</h2><p>Access denied.</p></section>;
  const mayDecide = canApproveCommercialIssuance(admin?.role);
  return (
    <section>
      <p className="eyebrow">Commercial licensing · test-mode foundation</p>
      <h2>Paid — awaiting approval</h2>
      <p>Review reconciled one-off annual orders. Approval queues private licence creation; it does not send a licence.</p>
      {message ? <div className="banner" role="status">{message}</div> : null}
      {mayDecide ? (
        <div className="card two-column-grid">
          <label>Password reauthentication<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
          <label>Hold/reject reason<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Required for hold or reject" /></label>
        </div>
      ) : <div className="banner">Read-only operator view. SUPER_ADMIN recent reauthentication is required for decisions.</div>}
      <div className="card-grid">
        {orders.map((order) => (
          <article className="card" key={order.publicOrderId}>
            <h3>{order.companyName}</h3>
            <p><strong>{order.state.replace(/_/g, ' ')}</strong></p>
            <dl className="detail-list">
              <div><dt>Order</dt><dd>{order.publicOrderId}</dd></div>
              <div><dt>Payment</dt><dd>£{(order.amountMinor / 100).toFixed(2)} {order.currency} · {order.payment?.status ?? 'Unavailable'}</dd></div>
              <div><dt>Product</dt><dd>{order.product} · Annual</dd></div>
              <div><dt>Client</dt><dd>{order.appVersion} / {order.buildId}</dd></div>
              <div><dt>Workstation</dt><dd>{order.workstationSummary}</dd></div>
              {order.holdReason ? <div><dt>Hold</dt><dd>{order.holdReason}</dd></div> : null}
            </dl>
            {mayDecide ? <div className="button-row">
              {order.state === 'PAID_AWAITING_APPROVAL' ? <>
                <button disabled={!password || busy !== null} onClick={() => void decide(order, 'approve')}>Approve and issue</button>
                <button className="secondary-button" disabled={!password || reason.trim().length < 3 || busy !== null} onClick={() => void decide(order, 'hold')}>Hold</button>
                <button className="danger-button" disabled={!password || reason.trim().length < 3 || busy !== null} onClick={() => void decide(order, 'reject')}>Reject</button>
              </> : null}
              {order.state === 'HELD' ? <button disabled={!password || reason.trim().length < 3 || busy !== null} onClick={() => void decide(order, 'release-hold')}>Release hold</button> : null}
            </div> : null}
          </article>
        ))}
        {orders.length === 0 ? <p className="empty-state">No paid orders are awaiting operator review.</p> : null}
      </div>
    </section>
  );
}
