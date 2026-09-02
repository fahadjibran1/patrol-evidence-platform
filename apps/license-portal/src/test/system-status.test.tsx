import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { AppLayout } from '../components/layout';
import { SystemStatusPage } from '../pages/system-status-page';
import type { AdminRole, SystemStatus } from '../types';

const systemStatus: SystemStatus = {
  version: '1.0.0',
  buildNumber: '42',
  environment: 'test',
  uptimeSeconds: 3661,
  database: { ok: true },
  redis: { configured: false, connected: false },
  queue: {
    mode: 'inline',
    queues: [
      { name: 'email', waiting: 0, active: 0, failed: 0, delayed: 0, mode: 'inline' },
      { name: 'notifications', waiting: 0, active: 0, failed: 0, delayed: 0, mode: 'inline' },
      { name: 'maintenance', waiting: 0, active: 0, failed: 0, delayed: 0, mode: 'inline' },
      { name: 'reports', waiting: 0, active: 0, failed: 0, delayed: 0, mode: 'inline' },
    ],
    pendingEmails: 2,
    failedEmails: 1,
  },
  smtp: { configured: true, host: 'smtp.example.com', fromEmail: 'licences@example.com' },
  cache: { dashboardCachedRoles: 1 },
};

function seedAuth(role: AdminRole): void {
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

describe('system status page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/admin/system/status')) {
          return {
            ok: true,
            status: 200,
            text: async (): Promise<string> => JSON.stringify(systemStatus),
          };
        }
        if (url.includes('/admin/exports/')) {
          return {
            ok: true,
            status: 200,
            blob: async (): Promise<Blob> => new Blob(['id,name\n'], { type: 'text/csv' }),
            text: async (): Promise<string> => 'id,name\n',
          };
        }
        return {
          ok: true,
          status: 200,
          text: async (): Promise<string> => JSON.stringify({}),
        };
      }),
    );
  });

  it('loads infrastructure and queue health for ADMIN', async () => {
    seedAuth('ADMIN');
    render(
      <MemoryRouter>
        <AuthProvider>
          <SystemStatusPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('1.0.0')).toBeInTheDocument();
    });
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Inline queue mode')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export Customers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export Revenue' })).toBeInTheDocument();
  });

  it('hides System status nav for SUPPORT', () => {
    seedAuth('SUPPORT');
    render(
      <MemoryRouter initialEntries={['/licences']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route path="licences" element={<div>Licences</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: 'System status' })).not.toBeInTheDocument();
  });

  it('shows System status nav for ADMIN', () => {
    seedAuth('ADMIN');
    render(
      <MemoryRouter initialEntries={['/licences']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route path="licences" element={<div>Licences</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'System status' })).toBeInTheDocument();
  });

  it('downloads a CSV export', async () => {
    const user = userEvent.setup();
    seedAuth('ADMIN');
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <SystemStatusPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Export Customers' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Export Customers' }));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
    });
  });
});
