import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { DashboardPage } from '../pages/dashboard-page';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  sessionStorage.setItem('patrol-license-portal-auth', JSON.stringify({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    admin: {
      id: 'admin-1',
      email: 'admin@patrol.local',
      displayName: 'Portal Admin',
      role: 'ADMIN',
      isActive: true,
    },
  }));
});

describe('DashboardPage', () => {
  it('loads dashboard cards from the API mock', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        totalCustomers: 12,
        activeLicences: 8,
        trials: 2,
        expiredLicences: 1,
        suspendedLicences: 1,
        expiringIn7Days: 3,
        expiringIn30Days: 5,
        outstandingPayments: 4,
        recentActivity: [],
        upcomingRenewals: [],
      }),
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Active licences')).toBeInTheDocument();
    });

    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Outstanding payments')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
