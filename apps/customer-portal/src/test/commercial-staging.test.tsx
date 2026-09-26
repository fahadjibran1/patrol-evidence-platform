import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommercialPurchasePage } from '../pages/commercial-purchase-page';
import { CommercialStatusPage } from '../pages/commercial-status-page';
import { validateStripeCheckoutUrl } from '../lib/commercial-staging';

const reference = 'A'.repeat(43);
const order = 'ord_74cc812c-4abf-4f06-a57e-3a4c1ad6ce27';
const response = (body: unknown, ok = true, status = 200) => ({ ok, status, text: async () => JSON.stringify(body) });
const orderStatus = (status: string, paymentReceived = true) => ({
  publicOrderId: order,
  product: 'PatrolSafe Annual Licence',
  amountMinor: 29900,
  currency: 'GBP',
  paymentReceived,
  status,
});

function renderStatus(query = '?checkout=success') {
  return render(<MemoryRouter initialEntries={[`/patrolsafe/licence/status/${order}${query}`]}><Routes><Route path='/patrolsafe/licence/status/:publicOrderId' element={<CommercialStatusPage />} /></Routes></MemoryRouter>);
}

describe('S4 commercial staging pages', () => {
  beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

  it('shows only customer-safe server-owned commercial terms', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ publicOrderId: order, product: 'PatrolSafe Annual Licence', plan: 'annual', companyName: 'Staging Patrol Ltd', amountMinor: 29900, currency: 'GBP', maxDevices: 1, taxPolicy: 'NOT_YET_PRODUCTION_AUTHORIZED', expiresAt: '2026-09-23T12:00:00Z' })));
    render(<MemoryRouter initialEntries={[`/patrolsafe/buy/${reference}`]}><Routes><Route path='/patrolsafe/buy/:reference' element={<CommercialPurchasePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Staging Patrol Ltd')).toBeInTheDocument();
    expect(screen.getByText(/£299/)).toBeInTheDocument();
    expect(screen.getByText('total (VAT included)')).toBeInTheDocument();
    expect(screen.queryByText(/VAT where applicable/i)).not.toBeInTheDocument();
    expect(screen.getByText('1 Windows workstation')).toBeInTheDocument();
    expect(screen.queryByText(/fingerprint|installation id|signing/i)).not.toBeInTheDocument();
  });

  it('submits contact data without price authority or reference persistence', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      if (!init?.method) return response({ publicOrderId: order, product: 'PatrolSafe Annual Licence', plan: 'annual', companyName: 'Staging Patrol Ltd', amountMinor: 29900, currency: 'GBP', maxDevices: 1, taxPolicy: 'NOT_YET_PRODUCTION_AUTHORIZED', expiresAt: '2026-09-23T12:00:00Z' });
      return response({ publicOrderId: order, checkoutUrl: 'https://checkout.stripe.test/cs_test_1', amountMinor: 29900, currency: 'GBP', duplicate: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={[`/patrolsafe/buy/${reference}`]}><Routes><Route path='/patrolsafe/buy/:reference' element={<CommercialPurchasePage />} /></Routes></MemoryRouter>);
    await screen.findByText('Staging Patrol Ltd');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'buyer@staging.test' } });
    fireEvent.click(screen.getByLabelText(/acknowledge/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to secure checkout' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toEqual({ customerEmail: 'buyer@staging.test' });
    expect(body).not.toHaveProperty('amount');
    expect(body).not.toHaveProperty('currency');
    expect(JSON.stringify(sessionStorage)).not.toContain(reference);
  });

  it('rejects attacker-controlled checkout destinations', () => {
    for (const url of ['http://checkout.stripe.com/test', 'https://attacker.example/test', 'javascript:alert(1)', 'https://user@checkout.stripe.com/test']) expect(() => validateStripeCheckoutUrl(url)).toThrow();
  });

  it('shows a stable successful Stripe return and remains stable after refresh', async () => {
    const fetchMock = vi.fn(async () => response(orderStatus('PAYMENT_RECEIVED')));
    vi.stubGlobal('fetch', fetchMock);
    const first = renderStatus();
    expect(await screen.findByRole('heading', { name: 'Thank you for your purchase' })).toBeInTheDocument();
    expect(screen.getByText('Your payment has been received successfully.')).toBeInTheDocument();
    expect(screen.getByText('PatrolSafe > Licence > Activate supplied licence')).toBeInTheDocument();
    expect(screen.getByText(order)).toBeInTheDocument();
    expect(screen.getByText('£299.00 · Paid')).toBeInTheDocument();
    first.unmount();
    renderStatus();
    expect(await screen.findByRole('heading', { name: 'Thank you for your purchase' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['PAYMENT_RECEIVED', 'Payment received'],
    ['LICENCE_PREPARING', 'Licence being prepared'],
    ['LICENCE_READY', 'Licence ready'],
    ['LICENCE_SENT', 'Licence sent'],
  ])('maps %s to customer-safe wording', async (status, wording) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(orderStatus(status))));
    renderStatus();
    expect(await screen.findByText(wording)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/PAID_AWAITING_APPROVAL|ISSUANCE_PENDING|DELIVERY_PENDING|approval queue|operator|outbox|signing|reconciliation/i);
  });

  it('does not depend on an expired original purchase reference', async () => {
    sessionStorage.setItem(`patrolsafe-commercial-reference:${order}`, reference);
    const fetchMock = vi.fn(async (_input: RequestInfo, _init?: RequestInit) => response(orderStatus('LICENCE_SENT')));
    vi.stubGlobal('fetch', fetchMock);
    renderStatus();
    expect(await screen.findByText('Licence sent')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/commercial/orders/${order}/status`);
    expect(init).toEqual({ redirect: 'error' });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(reference);
  });

  it('shows a safe cancelled-checkout experience', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(orderStatus('AWAITING_PAYMENT', false))));
    renderStatus('?checkout=cancelled');
    expect(await screen.findByRole('heading', { name: 'Checkout cancelled' })).toBeInTheDocument();
    expect(screen.getByText('Not completed')).toBeInTheDocument();
    expect(screen.queryByText(/payment has been received/i)).not.toBeInTheDocument();
  });

  it('rejects an invalid public order without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/patrolsafe/licence/status/not-an-order?checkout=success']}><Routes><Route path='/patrolsafe/licence/status/:publicOrderId' element={<CommercialStatusPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('This purchase status link is invalid.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails safely without leaking internal or sensitive values', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ code: 'COMMERCIAL_ORDER_NOT_FOUND', message: 'Purchase status was not found.' }, false, 404)));
    renderStatus();
    expect(await screen.findByText(/could not refresh this order/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/COMMERCIAL_ORDER_NOT_FOUND|purchase reference|delivery token|fingerprint|stripe|database|PAID_AWAITING_APPROVAL/i);
  });
});
