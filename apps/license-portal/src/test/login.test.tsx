import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { LoginPage } from '../pages/login-page';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  sessionStorage.clear();
});

function renderLogin(): void {
  render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  it('submits credentials and stores the session', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
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
    });

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'admin@patrol.local');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(sessionStorage.getItem('patrol-license-portal-auth')).toContain('access-token');
    });
  });

  it('shows API error codes cleanly', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        statusCode: 401,
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      }),
    });

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'admin@patrol.local');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('AUTH_INVALID_CREDENTIALS: Invalid email or password');
  });
});
