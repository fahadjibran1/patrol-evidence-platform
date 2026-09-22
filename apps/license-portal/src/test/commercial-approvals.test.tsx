import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { CommercialApprovalsPage } from '../pages/commercial-approvals-page';
import type { AdminRole } from '../types';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function renderRole(role: AdminRole) {
  sessionStorage.setItem('patrol-license-portal-auth', JSON.stringify({
    accessToken: 'access-token', refreshToken: 'refresh-token',
    admin: { id: 'admin-1', email: 'operator@example.test', displayName: 'Operator', role, isActive: true },
  }));
  render(<MemoryRouter><AuthProvider><CommercialApprovalsPage /></AuthProvider></MemoryRouter>);
}

describe('commercial approval portal', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify([{
      publicOrderId: 'ord_safe', state: 'PAID_AWAITING_APPROVAL', customer: { id: 'cust', companyName: 'Safe Patrols', email: 'buyer@example.test' },
      companyName: 'Safe Patrols', product: 'Patrol Evidence Platform', plan: 'annual', amountMinor: 29900, currency: 'GBP',
      payment: { status: 'SUCCEEDED', paidAt: '2026-09-22T12:00:00Z' }, requestAgeSeconds: 60, appVersion: '1.0.3', buildId: 'phase3',
      workstationSummary: '…deadbeef', previousLicenceId: null, holdReason: null, issuance: null,
    }]) });
  });

  it('provides SUPER_ADMIN decision controls with recent reauthentication', async () => {
    renderRole('SUPER_ADMIN');
    expect(await screen.findByText('Safe Patrols')).toBeInTheDocument();
    expect(screen.getByLabelText('Password reauthentication')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and issue' })).toBeDisabled();
    expect(screen.getByText('…deadbeef')).toBeInTheDocument();
  });

  it('keeps ADMIN review read-only and never renders signing internals', async () => {
    renderRole('ADMIN');
    expect(await screen.findByText('Safe Patrols')).toBeInTheDocument();
    expect(screen.getByText(/Read-only operator view/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and issue' })).not.toBeInTheDocument();
    await waitFor(() => expect(document.body.textContent).not.toContain('machineFingerprint'));
  });
});
