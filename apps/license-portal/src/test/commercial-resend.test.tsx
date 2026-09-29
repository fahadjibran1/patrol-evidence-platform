import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { SupportOpsPage } from '../pages/support-ops-page';
import type { AdminRole } from '../types';

const orderId = 'ord_12345678-1234-4123-8123-123456789abc';
const password = 'StagingOperatorPass!';
const reason = 'Customer requested a fresh secure download link';
const idempotencyKey = '12345678-1234-4123-8123-123456789abc';
const fetchMock = vi.fn();

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

function renderRole(role: AdminRole) {
  sessionStorage.setItem('patrol-license-portal-auth', JSON.stringify({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    admin: { id: 'admin-1', email: 'operator@example.test', displayName: 'Operator', role, isActive: true },
  }));
  render(<MemoryRouter><AuthProvider><SupportOpsPage /></AuthProvider></MemoryRouter>);
}

function enterResendDetails(): void {
  fireEvent.change(screen.getByLabelText('Commercial order'), { target: { value: orderId } });
  fireEvent.change(screen.getByLabelText('Resend reason'), { target: { value: reason } });
  fireEvent.change(screen.getByLabelText('Password reauthentication'), { target: { value: password } });
}

describe('commercial licence support resend', () => {
  beforeEach(() => {
    sessionStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(idempotencyKey);
    fetchMock.mockImplementation(async (input: RequestInfo) => {
      const path = String(input);
      if (path.includes('/admin/support/notifications/failed')) return response({ items: [] });
      if (path.endsWith('/admin/commercial/step-up')) return response({ stepUpToken: 'S'.repeat(43) });
      if (path.includes('/resend-licence')) return response({ queued: true, idempotent: false, requestId: 'request-safe' });
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  it('shows the non-reissue resend control only to SUPER_ADMIN', async () => {
    renderRole('SUPER_ADMIN');

    expect(await screen.findByRole('heading', { name: 'Resend commercial licence email' })).toBeInTheDocument();
    expect(screen.getByText(/existing immutable signed licence/i)).toBeInTheDocument();
    expect(screen.getByText(/does not reissue, regenerate, re-sign/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend licence email' })).toBeDisabled();
  });

  it.each<AdminRole>(['ADMIN', 'SUPPORT'])('does not expose commercial resend controls to %s', async (role) => {
    renderRole(role);

    await screen.findByRole('heading', { name: 'Failed notifications' });
    expect(screen.queryByRole('heading', { name: 'Resend commercial licence email' })).not.toBeInTheDocument();
  });

  it('uses password step-up and the existing resend endpoint with an idempotency key', async () => {
    renderRole('SUPER_ADMIN');
    await screen.findByRole('heading', { name: 'Resend commercial licence email' });
    enterResendDetails();

    fireEvent.click(screen.getByRole('button', { name: 'Resend licence email' }));

    expect(await screen.findByText('Fresh secure download link queued for the existing licence.')).toBeInTheDocument();
    const stepUpCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/admin/commercial/step-up'));
    const resendCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/resend-licence'));
    expect(stepUpCall).toBeDefined();
    expect(JSON.parse(String(stepUpCall?.[1]?.body))).toEqual({ password });
    expect(String(resendCall?.[0])).toContain(`/admin/commercial/orders/${orderId}/resend-licence`);
    expect(JSON.parse(String(resendCall?.[1]?.body))).toEqual({ reason });
    const headers = new Headers(resendCall?.[1]?.headers);
    expect(headers.get('X-Commercial-Step-Up')).toBe('S'.repeat(43));
    expect(headers.get('Idempotency-Key')).toBe(idempotencyKey);
  });

  it('reuses the same idempotency key after an ambiguous transient failure', async () => {
    let resendAttempts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo) => {
      const path = String(input);
      if (path.includes('/admin/support/notifications/failed')) return response({ items: [] });
      if (path.endsWith('/admin/commercial/step-up')) return response({ stepUpToken: 'S'.repeat(43) });
      if (path.includes('/resend-licence')) {
        resendAttempts += 1;
        return resendAttempts === 1
          ? response({ code: 'COMMERCIAL_DELIVERY_FAILED', message: 'Delivery is temporarily unavailable.' }, false, 503)
          : response({ queued: true, idempotent: true, requestId: 'request-safe' });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    renderRole('SUPER_ADMIN');
    await screen.findByRole('heading', { name: 'Resend commercial licence email' });
    enterResendDetails();

    fireEvent.click(screen.getByRole('button', { name: 'Resend licence email' }));
    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resend licence email' }));
    expect(await screen.findByText('Fresh secure download link queued for the existing licence.')).toBeInTheDocument();

    const keys = fetchMock.mock.calls
      .filter(([input]) => String(input).includes('/resend-licence'))
      .map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys).toEqual([idempotencyKey, idempotencyKey]);
    await waitFor(() => expect(resendAttempts).toBe(2));
  });
});
