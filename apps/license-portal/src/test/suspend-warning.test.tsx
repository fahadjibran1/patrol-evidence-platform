import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { LicenceDetailPage } from '../pages/licence-detail-page';

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

describe('LicenceDetailPage suspend warning', () => {
  it('shows offline enforcement warning for suspended licences', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: 'lic-1',
        licenseId: 'PEL-2026-000001',
        customerId: 'cust-1',
        plan: 'ANNUAL',
        status: 'SUSPENDED',
        effectiveStatus: 'SUSPENDED',
        startsAt: '2026-01-01',
        expiresAt: '2026-12-31',
        maxDevices: 3,
        updatedAt: '2026-07-01T00:00:00.000Z',
        features: [],
        installations: [],
        payments: [],
        renewals: [],
        auditLogs: [],
      }),
    });

    render(
      <MemoryRouter initialEntries={['/licences/lic-1']}>
        <AuthProvider>
          <Routes>
            <Route path="/licences/:id" element={<LicenceDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Offline enforcement limitation')).toBeInTheDocument();
    expect(screen.getByText(/Offline desktop licences already activated/i)).toBeInTheDocument();
  });

  it('shows portal-only enforcement guidance in the action panel', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: 'lic-1',
        licenseId: 'PEL-2026-000001',
        customerId: 'cust-1',
        plan: 'ANNUAL',
        status: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
        startsAt: '2026-01-01',
        expiresAt: '2026-12-31',
        maxDevices: 3,
        updatedAt: '2026-07-01T00:00:00.000Z',
        features: [],
        installations: [],
        payments: [],
        renewals: [],
        auditLogs: [],
      }),
    });

    render(
      <MemoryRouter initialEntries={['/licences/lic-1']}>
        <AuthProvider>
          <Routes>
            <Route path="/licences/:id" element={<LicenceDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Suspension and revocation')).toBeInTheDocument();
    });

    expect(screen.getByText('Portal-only enforcement')).toBeInTheDocument();
  });
});
