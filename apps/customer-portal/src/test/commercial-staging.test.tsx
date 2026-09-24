import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommercialPurchasePage } from '../pages/commercial-purchase-page';
import { CommercialStatusPage } from '../pages/commercial-status-page';
import { customerStatus, purchaseSessionKey, validateStripeCheckoutUrl } from '../lib/commercial-staging';

const reference = 'A'.repeat(43);
const order = 'ord_74cc812c-4abf-4f06-a57e-3a4c1ad6ce27';

describe('S4 commercial staging pages', () => {
  beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

  it('shows only customer-safe server-owned commercial terms', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ publicOrderId: order, product: 'PatrolSafe Annual Licence', plan: 'annual', companyName: 'Staging Patrol Ltd', amountMinor: 29900, currency: 'GBP', maxDevices: 1, taxPolicy: 'NOT_YET_PRODUCTION_AUTHORIZED', expiresAt: '2026-09-23T12:00:00Z', orderState: 'REQUEST_CREATED' }) })));
    render(<MemoryRouter initialEntries={[`/patrolsafe/buy/${reference}`]}><Routes><Route path="/patrolsafe/buy/:reference" element={<CommercialPurchasePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Staging Patrol Ltd')).toBeInTheDocument();
    expect(screen.getByText(/£299/)).toBeInTheDocument();
    expect(screen.getByText('total (VAT included)')).toBeInTheDocument();
    expect(screen.queryByText(/VAT where applicable/i)).not.toBeInTheDocument();
    expect(screen.getByText('1 Windows workstation')).toBeInTheDocument();
    expect(screen.queryByText(/fingerprint|installation id|signing/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to secure checkout' })).toBeDisabled();
  });

  it('requires acknowledgement and submits contact data without price authority', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      if (!init?.method) return { ok: true, status: 200, text: async () => JSON.stringify({ publicOrderId: order, product: 'PatrolSafe Annual Licence', plan: 'annual', companyName: 'Staging Patrol Ltd', amountMinor: 29900, currency: 'GBP', maxDevices: 1, taxPolicy: 'NOT_YET_PRODUCTION_AUTHORIZED', expiresAt: '2026-09-23T12:00:00Z', orderState: 'REQUEST_CREATED' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ publicOrderId: order, checkoutUrl: 'https://checkout.stripe.test/cs_test_1', amountMinor: 29900, currency: 'GBP', duplicate: false }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={[`/patrolsafe/buy/${reference}`]}><Routes><Route path="/patrolsafe/buy/:reference" element={<CommercialPurchasePage />} /></Routes></MemoryRouter>);
    await screen.findByText('Staging Patrol Ltd');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'buyer@staging.test' } });
    fireEvent.click(screen.getByLabelText(/acknowledge/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to secure checkout' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toEqual({ customerEmail: 'buyer@staging.test' });
    expect(body).not.toHaveProperty('amount');
    expect(body).not.toHaveProperty('currency');
    expect(sessionStorage.getItem(purchaseSessionKey(order))).toBe(reference);
  });

  it('rejects attacker-controlled checkout destinations', () => {
    for (const url of ['http://checkout.stripe.com/test', 'https://attacker.example/test', 'javascript:alert(1)', 'https://user@checkout.stripe.com/test']) {
      expect(() => validateStripeCheckoutUrl(url)).toThrow();
    }
  });

  it('maps state safely and recovers status only from the same browser session', async () => {
    expect(customerStatus('PAID_AWAITING_APPROVAL')).toBe('Payment received — awaiting approval');
    sessionStorage.setItem(purchaseSessionKey(order), reference);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ orderState: 'ISSUANCE_PENDING' }) })));
    render(<MemoryRouter initialEntries={[`/patrolsafe/licence/status/${order}`]}><Routes><Route path="/patrolsafe/licence/status/:publicOrderId" element={<CommercialStatusPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Licence being prepared')).toBeInTheDocument();
  });
});
