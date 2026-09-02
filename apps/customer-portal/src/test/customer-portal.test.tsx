import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { LoginPage } from '../pages/login-page';
import { DashboardPage } from '../pages/dashboard-page';
import { LicencesPage } from '../pages/licences-page';

function seedAuth(): void {
  sessionStorage.setItem(
    'patrol-customer-portal-auth',
    JSON.stringify({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      customer: {
        id: 'user-1',
        email: 'portal@acme.test',
        displayName: 'Acme Portal',
        customerId: 'cust-1',
        companyId: 'cust-1',
        role: 'OWNER',
        permissions: ['DOWNLOAD_LICENCE', 'VIEW_LICENCES', 'VIEW_DASHBOARD'],
        emailVerified: true,
      },
    }),
  );
}

describe('customer portal', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('logs in with customer credentials', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async (): Promise<string> =>
          JSON.stringify({
            customer: {
              sub: 'user-1',
              email: 'portal@acme.test',
              displayName: 'Acme Portal',
              customerId: 'cust-1',
              companyId: 'cust-1',
              role: 'OWNER',
              permissions: ['DOWNLOAD_LICENCE', 'VIEW_LICENCES', 'MANAGE_OWN_PROFILE'],
              emailVerified: true,
            },
            tokens: {
              accessToken: 'access-token',
              refreshToken: 'refresh-token',
              expiresIn: '15m',
              sessionId: 'session-1',
              rememberMe: false,
            },
          }),
      })),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'portal@acme.test');
    await user.type(screen.getByLabelText('Password'), 'CustomerPass123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      const stored = JSON.parse(sessionStorage.getItem('patrol-customer-portal-auth') ?? '{}');
      expect(stored.accessToken).toBe('access-token');
      expect(stored.customer.email).toBe('portal@acme.test');
    });
  });

  it('renders dashboard cards without TG1 material', async () => {
    seedAuth();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async (): Promise<string> =>
          JSON.stringify({
            company: {
              id: 'cust-1',
              companyName: 'Acme Security',
              tradingName: null,
              status: 'ACTIVE',
              email: 'ops@acme.test',
            },
            currentLicence: {
              id: 'lic-1',
              licenseId: 'PEL-2026-000001',
              status: 'ACTIVE',
              effectiveStatus: 'ACTIVE',
              plan: 'ANNUAL',
              issuedAt: '2026-01-01T00:00:00.000Z',
              startsAt: '2026-01-01',
              expiresAt: '2027-01-01',
              maxDevices: 3,
              currentVersionNumber: 1,
              downloadCount: 0,
              lastDownloadedAt: null,
              hasDownloadableFile: true,
            },
            status: 'ACTIVE',
            plan: 'ANNUAL',
            expiry: '2027-01-01',
            deviceAllowance: 3,
            latestDownload: null,
            latestNotification: null,
            renewalCountdownDays: 120,
          }),
      })),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Acme Security')).toBeInTheDocument();
    });
    expect(screen.getByText('PEL-2026-000001')).toBeInTheDocument();
    expect(screen.queryByText(/TG1\./)).not.toBeInTheDocument();
  });

  it('downloads the active licence file', async () => {
    const user = userEvent.setup();
    seedAuth();
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/download')) {
          return {
            ok: true,
            status: 200,
            blob: async (): Promise<Blob> => new Blob(['TG1.payload.sig']),
            text: async (): Promise<string> => 'TG1.payload.sig',
          };
        }
        return {
          ok: true,
          status: 200,
          text: async (): Promise<string> =>
            JSON.stringify({
              items: [
                {
                  id: 'lic-1',
                  licenseId: 'PEL-2026-000001',
                  status: 'ACTIVE',
                  effectiveStatus: 'ACTIVE',
                  plan: 'ANNUAL',
                  issuedAt: '2026-01-01T00:00:00.000Z',
                  startsAt: '2026-01-01',
                  expiresAt: '2027-01-01',
                  maxDevices: 3,
                  currentVersionNumber: 1,
                  downloadCount: 0,
                  lastDownloadedAt: null,
                  hasDownloadableFile: true,
                },
              ],
              total: 1,
            }),
        };
      }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <LicencesPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
    });
  });
});
