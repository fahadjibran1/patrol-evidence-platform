import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../lib/auth';
import { LoginPage } from '../pages/login-page';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  sessionStorage.clear();
});

function apiLoginSuccessBody() {
  return {
    admin: {
      sub: 'admin-1',
      email: 'admin@patrol.local',
      displayName: 'Portal Admin',
      role: 'SUPER_ADMIN',
    },
    tokens: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: '15m',
    },
  };
}

function mockJsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  const status = init?.status ?? 200;
  const ok = init?.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

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
  it('submits credentials, stores the session from { admin, tokens }, and redirects to /', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(apiLoginSuccessBody()));

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<div>Dashboard ready</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'admin@patrol.local');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(sessionStorage.getItem('patrol-license-portal-auth')).toContain('access-token');
      expect(sessionStorage.getItem('patrol-license-portal-auth')).toContain('refresh-token');
      expect(sessionStorage.getItem('patrol-license-portal-auth')).toContain('admin-1');
    });

    expect(await screen.findByText('Dashboard ready')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'admin@patrol.local', password: 'Password123!' }),
      }),
    );
  });

  it('shows API error codes for invalid credentials and re-enables the button', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse(
        {
          statusCode: 401,
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        },
        { ok: false, status: 401 },
      ),
    );

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'admin@patrol.local');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'AUTH_INVALID_CREDENTIALS: Invalid email or password',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
  });

  it('shows a clear error when the API is unavailable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'admin@patrol.local');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch');
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
  });

  it('rejects a malformed login response and resets loading state', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        accessToken: 'flat-access',
        refreshToken: 'flat-refresh',
        admin: { id: 'admin-1', email: 'admin@patrol.local' },
      }),
    );

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'admin@patrol.local');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/tokens are missing|incomplete|Malformed/i);
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
    expect(sessionStorage.getItem('patrol-license-portal-auth')).toBeNull();
  });

  it('uses username/current-password autocomplete attributes', () => {
    renderLogin();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autoComplete', 'username');
    expect(screen.getByLabelText('Email')).toHaveAttribute('name', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autoComplete', 'current-password');
    expect(screen.getByLabelText('Password')).toHaveAttribute('name', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit');
  });

  it('keeps protected routes accessible after a successful login', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/admin/auth/login')) {
        return mockJsonResponse(apiLoginSuccessBody());
      }
      if (url.includes('/admin/auth/refresh')) {
        return mockJsonResponse({
          accessToken: 'access-token-refreshed',
          refreshToken: 'refresh-token-refreshed',
          expiresIn: '15m',
        });
      }
      if (url.includes('/admin/auth/me')) {
        return mockJsonResponse({
          sub: 'admin-1',
          email: 'admin@patrol.local',
          displayName: 'Portal Admin',
          role: 'SUPER_ADMIN',
        });
      }
      if (url.includes('/admin/dashboard')) {
        return mockJsonResponse({
          generatedAt: '2026-07-21T12:00:00.000Z',
          kpis: {
            activeCustomers: 0,
            activeLicences: 0,
            trialLicences: 0,
            monthlyLicences: 0,
            annualLicences: 0,
            expiredLicences: 0,
            expiringIn7Days: 0,
            expiringIn30Days: 0,
            emailsSentToday: 0,
            failedEmailsToday: 0,
          },
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
        });
      }

      return mockJsonResponse({});
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'admin@patrol.local');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Licence Portal')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Administrator sign in' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem('patrol-license-portal-auth')).toContain('access-token');
  });
});
