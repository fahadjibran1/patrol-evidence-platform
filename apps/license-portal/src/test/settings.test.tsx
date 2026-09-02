import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { SettingsPage } from '../pages/settings-page';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  sessionStorage.setItem(
    'patrol-license-portal-auth',
    JSON.stringify({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      admin: {
        id: 'admin-1',
        email: 'admin@patrol.local',
        displayName: 'Portal Admin',
        role: 'ADMIN',
        isActive: true,
      },
    }),
  );
});

describe('SettingsPage', () => {
  it('loads safe signing-key and SMTP metadata without secrets', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/admin/settings/signing-key')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              keyId: 'primary-2026',
              ready: true,
              algorithm: 'Ed25519',
            }),
        };
      }
      if (url.includes('/admin/settings/smtp')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              configured: true,
              host: 'smtp.example.com',
              port: 587,
              secure: false,
              fromName: 'Patrol Licence Portal',
              fromEmail: 'licences@example.com',
            }),
        };
      }
      return { ok: false, status: 404, text: async () => '{}' };
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <SettingsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('primary-2026')).toBeInTheDocument();
    expect(screen.getByText('Ed25519')).toBeInTheDocument();
    expect(screen.getByText('smtp.example.com')).toBeInTheDocument();
    expect(screen.getByText('587')).toBeInTheDocument();
    expect(screen.getByText('licences@example.com')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument();

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toEqual(
      expect.arrayContaining(['/admin/settings/signing-key', '/admin/settings/smtp']),
    );
  });
});
