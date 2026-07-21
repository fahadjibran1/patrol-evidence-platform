import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { SettingsPage } from '../pages/settings-page';

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

describe('SettingsPage', () => {
  it('loads safe signing-key metadata from /admin/settings/signing-key', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        keyId: 'primary-2026',
        ready: true,
        algorithm: 'Ed25519',
      }),
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
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/admin/settings/signing-key', expect.anything());

    const response = await fetchMock.mock.results[0].value;
    const body = JSON.parse(await response.text());
    expect(Object.keys(body).sort()).toEqual(['algorithm', 'keyId', 'ready']);
    expect(JSON.stringify(body)).not.toMatch(/BEGIN|PRIVATE|pem|encryption/i);
  });
});
