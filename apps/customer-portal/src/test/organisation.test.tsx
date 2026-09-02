import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { LoginPage } from '../pages/login-page';
import { UsersPage } from '../pages/users-page';

function seedOwnerAuth(): void {
  sessionStorage.setItem(
    'patrol-customer-portal-auth',
    JSON.stringify({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      customer: {
        id: 'user-1',
        email: 'owner@acme.test',
        displayName: 'Owner',
        customerId: 'cust-1',
        companyId: 'cust-1',
        role: 'OWNER',
        permissions: [
          'VIEW_DASHBOARD',
          'VIEW_LICENCES',
          'DOWNLOAD_LICENCE',
          'VIEW_NOTIFICATIONS',
          'MANAGE_OWN_PROFILE',
          'MANAGE_ORG_PROFILE',
          'MANAGE_USERS',
          'MANAGE_INVITATIONS',
          'VIEW_ACTIVITY',
          'MANAGE_SESSIONS',
        ],
        emailVerified: true,
      },
    }),
  );
}

describe('customer portal organisation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('logs in with remember-me', async () => {
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
              email: 'owner@acme.test',
              displayName: 'Owner',
              customerId: 'cust-1',
              companyId: 'cust-1',
              role: 'OWNER',
              permissions: ['MANAGE_USERS'],
              emailVerified: true,
            },
            tokens: {
              accessToken: 'access-token',
              refreshToken: 'refresh-token',
              expiresIn: '15m',
              sessionId: 'session-1',
              rememberMe: true,
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

    await user.type(screen.getByLabelText('Email'), 'owner@acme.test');
    await user.type(screen.getByLabelText('Password'), 'CustomerPass123!');
    await user.click(screen.getByLabelText('Remember me'));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(localStorage.getItem('patrol-customer-portal-auth')).toBeTruthy();
    });
  });

  it('lists organisation users for owners', async () => {
    seedOwnerAuth();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async (): Promise<string> =>
          JSON.stringify({
            items: [
              {
                id: 'user-1',
                email: 'owner@acme.test',
                displayName: 'Owner',
                phone: null,
                role: 'OWNER',
                permissions: [],
                isActive: true,
                emailVerified: true,
                lastLoginAt: null,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            total: 1,
          }),
      })),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <UsersPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('owner@acme.test')).toBeInTheDocument();
    });
  });
});
