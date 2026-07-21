import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { ISSUE_WIZARD_STORAGE_KEY } from '../lib/issue-wizard-state';
import { poundsToPence } from '../lib/money';
import { computeExpiresAtIso } from '../lib/plan-dates';
import { IssueLicencePage } from '../pages/issue-licence-page';

const fetchMock = vi.fn();

function mockJson(body: unknown, init?: { ok?: boolean; status?: number }) {
  const status = init?.status ?? 200;
  return {
    ok: init?.ok ?? status < 400,
    status,
    text: async () => JSON.stringify(body),
  };
}

function seedAuth(role: 'ADMIN' | 'SUPPORT' | 'SUPER_ADMIN' = 'ADMIN') {
  sessionStorage.setItem('patrol-license-portal-auth', JSON.stringify({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    admin: {
      id: 'admin-1',
      email: 'admin@patrol.local',
      displayName: 'Portal Admin',
      role,
      isActive: true,
    },
  }));
}

function customersPayload(items = [{
  id: 'cust-1',
  companyName: 'ABC Security Ltd',
  contactName: 'Alex',
  email: 'billing@abc.security',
  status: 'ACTIVE',
  updatedAt: '2026-07-01T00:00:00.000Z',
}]) {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 100,
    totalPages: 1,
  };
}

function renderWizard() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <IssueLicencePage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  sessionStorage.clear();
  seedAuth();
  vi.stubGlobal('fetch', fetchMock);
});

describe('money helpers', () => {
  it('converts pounds to integer pence without floats', () => {
    expect(poundsToPence('12.50')).toBe(1250);
    expect(poundsToPence('0.01')).toBe(1);
    expect(() => poundsToPence('12.333')).toThrow();
  });
});

describe('IssueLicencePage wizard', () => {
  it('loads customers into searchable selector and blocks continue without selection', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJson(customersPayload()))
      .mockResolvedValueOnce(mockJson({ keyId: 'primary-2026', ready: true, algorithm: 'Ed25519' }));

    renderWizard();
    expect(await screen.findByRole('option', { name: /ABC Security Ltd/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Select a customer/i);
  });

  it('filters customers by search and shows empty state only on success', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJson(customersPayload([
        {
          id: 'cust-1',
          companyName: 'ABC Security Ltd',
          contactName: 'Alex',
          email: 'billing@abc.security',
          status: 'ACTIVE',
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
        {
          id: 'cust-2',
          companyName: 'Other Co',
          contactName: 'Sam',
          email: 'other@example.com',
          status: 'ACTIVE',
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      ])))
      .mockResolvedValueOnce(mockJson({ keyId: 'primary-2026', ready: true, algorithm: 'Ed25519' }));

    renderWizard();
    await screen.findByText('ABC Security Ltd');
    await userEvent.type(screen.getByLabelText('Search customers'), 'other');
    expect(screen.queryByText('ABC Security Ltd')).not.toBeInTheDocument();
    expect(screen.getByText('Other Co')).toBeInTheDocument();
  });

  it('shows API error when customers fail to load', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJson({ code: 'VALIDATION_ERROR', message: 'bad' }, { ok: false, status: 400 }))
      .mockResolvedValueOnce(mockJson({ keyId: 'primary-2026', ready: true, algorithm: 'Ed25519' }));

    renderWizard();
    expect(await screen.findByRole('alert')).toHaveTextContent(/VALIDATION_ERROR|bad/i);
  });

  it('shows empty customer response without treating it as an error', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJson(customersPayload([])))
      .mockResolvedValueOnce(mockJson({ keyId: 'primary-2026', ready: true, algorithm: 'Ed25519' }));

    renderWizard();
    expect(await screen.findByText('No customers found')).toBeInTheDocument();
  });

  it('preserves state across back/forward and auto-calculates expiry', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJson(customersPayload()))
      .mockResolvedValueOnce(mockJson({ keyId: 'primary-2026', ready: true, algorithm: 'Ed25519' }));

    const user = userEvent.setup();
    renderWizard();
    await user.click(await screen.findByRole('option', { name: /ABC Security Ltd/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Plan and dates')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /MONTHLY/i }));
    const expected = computeExpiresAtIso(
      // read from start field default — use today's computed value from draft storage
      JSON.parse(sessionStorage.getItem(ISSUE_WIZARD_STORAGE_KEY) || '{}').startsAt,
      'MONTHLY',
    );
    expect(JSON.parse(sessionStorage.getItem(ISSUE_WIZARD_STORAGE_KEY) || '{}').expiresAt).toBe(expected);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByLabelText('Maximum devices')).toHaveValue(1);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: /MONTHLY/i })).toHaveClass('selected');
  });

  it('requires confirmation checkbox and prevents double submission on success path', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/admin/customers')) {
        return mockJson(customersPayload());
      }
      if (url.includes('/admin/settings/signing-key')) {
        return mockJson({ keyId: 'primary-2026', ready: true, algorithm: 'Ed25519' });
      }
      if (url.includes('/admin/licences/issue')) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return mockJson({
          licence: {
            id: 'lic-1',
            licenseId: 'PEL-2026-000010',
            customerId: 'cust-1',
            companyName: 'ABC Security Ltd',
            plan: 'ANNUAL',
            status: 'ACTIVE',
            startsAt: '2026-07-21',
            expiresAt: '2027-07-20',
            maxDevices: 1,
            features: ['collector'],
            signingKeyId: 'primary-2026',
            updatedAt: '2026-07-21T00:00:00.000Z',
          },
          fullLicenseKey: 'TG1.payload.signature',
          licenseKey: 'TG1.payload.signature',
        });
      }
      return mockJson({});
    });

    const user = userEvent.setup();
    renderWizard();
    await user.click(await screen.findByRole('option', { name: /ABC Security Ltd/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/I have reviewed the customer/i)).toBeInTheDocument();
    const issueButton = screen.getByRole('button', { name: 'Issue and sign licence' });
    expect(issueButton).toBeDisabled();

    await user.click(screen.getByLabelText(/I have reviewed the customer/i));
    expect(issueButton).not.toBeDisabled();
    await user.click(issueButton);
    await user.click(issueButton);

    expect(await screen.findByText('Licence issued')).toBeInTheDocument();
    expect(screen.getByLabelText('Issued TG1 licence key')).toHaveTextContent('TG1.payload.signature');
    expect(sessionStorage.getItem(ISSUE_WIZARD_STORAGE_KEY)).toBeNull();
    expect(JSON.stringify(sessionStorage)).not.toContain('TG1.payload.signature');

    const issueCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/admin/licences/issue'));
    expect(issueCalls).toHaveLength(1);
  });

  it('blocks SUPPORT from issuing', async () => {
    seedAuth('SUPPORT');
    fetchMock.mockResolvedValue(mockJson({}));
    renderWizard();
    expect(await screen.findByText(/SUPPORT users cannot issue/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue and sign licence' })).not.toBeInTheDocument();
  });

  it('shows safe API failure on issue error', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/admin/customers')) return mockJson(customersPayload());
      if (url.includes('/admin/settings/signing-key')) {
        return mockJson({ keyId: 'primary-2026', ready: true, algorithm: 'Ed25519' });
      }
      if (url.includes('/admin/licences/issue')) {
        return mockJson({ code: 'LICENCE_SIGNING_FAILED', message: 'Failed to sign' }, { ok: false, status: 500 });
      }
      return mockJson({});
    });

    const user = userEvent.setup();
    renderWizard();
    await user.click(await screen.findByRole('option', { name: /ABC Security Ltd/ }));
    for (const _ of [1, 2, 3, 4]) {
      await user.click(screen.getByRole('button', { name: 'Continue' }));
    }
    await user.click(screen.getByLabelText(/I have reviewed the customer/i));
    await user.click(screen.getByRole('button', { name: 'Issue and sign licence' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/LICENCE_SIGNING_FAILED|Failed to sign/i);
  });
});
