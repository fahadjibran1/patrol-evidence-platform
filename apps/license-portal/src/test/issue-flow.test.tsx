import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { IssueLicencePage } from '../pages/issue-licence-page';

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

describe('IssueLicencePage', () => {
  it('walks through confirmation and shows the issued TG1 key', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          items: [{
            id: 'cust-1',
            companyName: 'ABC Security Ltd',
            email: 'billing@abc.security',
            status: 'ACTIVE',
            updatedAt: '2026-07-01T00:00:00.000Z',
          }],
          total: 1,
          page: 1,
          pageSize: 200,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          licence: {
            id: 'lic-1',
            licenseId: 'PEL-2026-000001',
            customerId: 'cust-1',
            plan: 'ANNUAL',
            status: 'ACTIVE',
            effectiveStatus: 'ACTIVE',
            startsAt: '2026-07-01',
            expiresAt: '2027-06-30',
            maxDevices: 3,
            updatedAt: '2026-07-01T00:00:00.000Z',
            payloadSummary: {
              licenseId: 'PEL-2026-000001',
              companyName: 'ABC Security Ltd',
              plan: 'annual',
              startsAt: '2026-07-01',
              expiresAt: '2027-06-30',
              maxDevices: 3,
              features: [],
            },
          },
          licenseKey: 'TG1.eyJ2ZXJzaW9uIjoxfQ.signature',
        }),
      });

    render(
      <MemoryRouter>
        <AuthProvider>
          <IssueLicencePage />
        </AuthProvider>
      </MemoryRouter>,
    );

    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText('ABC Security Ltd')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Review and confirm' }));
    expect(await screen.findByText('Confirm licence issue')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Issue licence' }));

    expect(await screen.findByText('Licence issued')).toBeInTheDocument();
    expect(screen.getByLabelText('Issued TG1 licence key')).toHaveTextContent('TG1.eyJ2ZXJzaW9uIjoxfQ.signature');
    expect(screen.getByRole('button', { name: 'Copy key' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download .txt' })).toBeInTheDocument();
  });
});
