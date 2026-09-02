import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { DashboardPage } from '../pages/dashboard-page';
import type { AdminRole, DashboardStats } from '../types';

const fetchMock = vi.fn();

function seedAuth(role: AdminRole = 'ADMIN') {
  sessionStorage.setItem(
    'patrol-license-portal-auth',
    JSON.stringify({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      admin: {
        id: 'admin-1',
        email: 'admin@patrol.local',
        displayName: 'Portal Admin',
        role,
        isActive: true,
      },
    }),
  );
}

function dashboardPayload(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    generatedAt: '2026-07-21T12:00:00.000Z',
    kpis: {
      activeCustomers: 12,
      activeLicences: 8,
      trialLicences: 2,
      monthlyLicences: 3,
      annualLicences: 3,
      expiredLicences: 1,
      expiringIn7Days: 3,
      expiringIn30Days: 5,
      suspendedLicences: 2,
      revokedLicences: 1,
      renewedThisMonth: 4,
      emailsSentToday: 4,
      failedEmailsToday: 1,
    },
    renewalQueue: [
      {
        id: 'lic-1',
        licenseId: 'PEL-2026-000001',
        customerId: 'cust-1',
        customerName: 'ABC Security Ltd',
        plan: 'ANNUAL',
        status: 'ACTIVE',
        effectiveStatus: 'EXPIRING_SOON',
        expiresAt: '2026-07-28',
        daysUntilExpiry: 7,
        canRenew: true,
        canReactivate: false,
      },
    ],
    recentActivity: [
      {
        id: 'a1',
        action: 'licence.emailed',
        entityType: 'Licence',
        entityId: 'lic-1',
        licenceId: 'lic-1',
        actorDisplayName: 'Portal Admin',
        createdAt: '2026-07-21T11:00:00.000Z',
      },
    ],
    notificationHealth: {
      sentToday: 4,
      failedToday: 1,
      pendingToday: 0,
      recentFailures: [
        {
          id: 'n1',
          notificationType: 'LICENSE_ISSUED',
          provider: 'EMAIL',
          recipient: 'billing@abc.security',
          subject: 'Licence',
          status: 'FAILED',
          errorMessage: 'SMTP is not configured',
          createdAt: '2026-07-21T10:30:00.000Z',
        },
      ],
    },
    revenue: {
      currency: 'GBP',
      outstandingPaymentsCount: 2,
      outstandingPaymentsAmountPence: 5000,
      paidTodayCount: 1,
      paidTodayAmountPence: 12000,
      paidThisMonthCount: 3,
      paidThisMonthAmountPence: 36000,
    },
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  sessionStorage.clear();
});

describe('DashboardPage', () => {
  it('loads KPI cards, renewal queue, activity, notification health, and revenue for ADMIN', async () => {
    seedAuth('ADMIN');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(dashboardPayload()),
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Active licences')).toBeInTheDocument();
    expect(screen.getByText('Active customers')).toBeInTheDocument();
    expect(screen.getByText('Trial licences')).toBeInTheDocument();
    expect(screen.getByText('Monthly licences')).toBeInTheDocument();
    expect(screen.getByText('Annual licences')).toBeInTheDocument();
    expect(screen.getByText('Emails sent today')).toBeInTheDocument();
    expect(screen.getByText('Failed emails today')).toBeInTheDocument();
    expect(screen.getByText('Renewal queue (next 30 days)')).toBeInTheDocument();
    expect(screen.getByText('PEL-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('ABC Security Ltd')).toBeInTheDocument();
    expect(screen.getByText('Notification health')).toBeInTheDocument();
    expect(screen.getByText('SMTP is not configured')).toBeInTheDocument();
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
    expect(screen.getByText(/licence emailed/i)).toBeInTheDocument();
    expect(screen.getByText('Outstanding payments')).toBeInTheDocument();
    expect(screen.getByText('Paid this month')).toBeInTheDocument();

    expect(screen.getByText('Suspended')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText('Renewed this month')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Renew' })).toHaveAttribute('href', '/licences/lic-1/renew');
  });

  it('hides revenue cards for SUPPORT', async () => {
    seedAuth('SUPPORT');
    const payload = dashboardPayload();
    delete payload.revenue;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Active licences')).toBeInTheDocument();
    expect(screen.getByText('Notification health')).toBeInTheDocument();
    expect(screen.queryByText('Outstanding payments')).not.toBeInTheDocument();
    expect(screen.queryByText('Paid today')).not.toBeInTheDocument();
    expect(screen.queryByText('Paid this month')).not.toBeInTheDocument();
  });

  it('hides the renewal queue Renew link when canRenew is false', async () => {
    seedAuth('SUPPORT');
    const payload = dashboardPayload({
      renewalQueue: [
        {
          id: 'lic-1',
          licenseId: 'PEL-2026-000001',
          customerId: 'cust-1',
          customerName: 'ABC Security Ltd',
          plan: 'ANNUAL',
          status: 'ACTIVE',
          effectiveStatus: 'EXPIRING_SOON',
          expiresAt: '2026-07-28',
          daysUntilExpiry: 7,
          canRenew: false,
          canReactivate: false,
        },
      ],
    });
    delete payload.revenue;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('PEL-2026-000001')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Renew' })).not.toBeInTheDocument();
  });

  it('shows loading skeletons then empty states', async () => {
    seedAuth('ADMIN');
    let resolveFetch: ((value: unknown) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Loading dashboard…')).toBeInTheDocument();

    resolveFetch?.({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify(
          dashboardPayload({
            renewalQueue: [],
            recentActivity: [],
            notificationHealth: {
              sentToday: 0,
              failedToday: 0,
              pendingToday: 0,
              recentFailures: [],
            },
            revenue: {
              currency: 'GBP',
              outstandingPaymentsCount: 0,
              outstandingPaymentsAmountPence: 0,
              paidTodayCount: 0,
              paidTodayAmountPence: 0,
              paidThisMonthCount: 0,
              paidThisMonthAmountPence: 0,
            },
          }),
        ),
    });

    await waitFor(() => {
      expect(screen.getByText('No licences due for renewal in the next 30 days.')).toBeInTheDocument();
    });
    expect(screen.getByText('No recent activity recorded.')).toBeInTheDocument();
    expect(screen.getByText('No recent notification failures.')).toBeInTheDocument();
  });

  it('shows an error banner when the dashboard API fails', async () => {
    seedAuth('ADMIN');
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ message: 'Dashboard unavailable' }),
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Dashboard unavailable|Failed to load dashboard|500/i)).toBeInTheDocument();
  });
});
