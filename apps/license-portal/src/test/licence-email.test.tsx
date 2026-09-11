import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { EmailLicenceModal } from '../components/email-licence-modal';
import { IssueLicencePage } from '../pages/issue-licence-page';
import { LicenceDetailPage } from '../pages/licence-detail-page';
import type { AdminRole } from '../types';

const fetchMock = vi.fn();
const TG1 = 'TG1.abc.payload.signature';

function mockJson(body: unknown, init?: { ok?: boolean; status?: number }) {
  const status = init?.status ?? 200;
  return {
    ok: init?.ok ?? status < 400,
    status,
    text: async () => JSON.stringify(body),
  };
}

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

function customersPayload() {
  return {
    items: [
      {
        id: 'cust-1',
        companyName: 'ABC Security Ltd',
        contactName: 'Alex',
        email: 'billing@abc.security',
        status: 'ACTIVE',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 100,
    totalPages: 1,
  };
}

async function reachSuccessScreen(user: ReturnType<typeof userEvent.setup>) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/admin/customers')) {
      return mockJson(customersPayload());
    }
    if (url.includes('/admin/settings/signing-key')) {
      return mockJson({ keyId: 'primary-2026', ready: true, algorithm: 'Ed25519' });
    }
    if (url.includes('/admin/licences/issue')) {
      return mockJson({
        licence: {
          id: 'lic-1',
          licenseId: 'PEL-2026-000001',
          customerId: 'cust-1',
          companyName: 'ABC Security Ltd',
          customerEmail: 'billing@abc.security',
          plan: 'ANNUAL',
          status: 'ACTIVE',
          startsAt: '2026-07-21',
          expiresAt: '2027-07-20',
          maxDevices: 1,
          features: ['collector'],
          signingKeyId: 'primary-2026',
          updatedAt: '2026-07-21T00:00:00.000Z',
        },
        fullLicenseKey: TG1,
        licenseKey: TG1,
      });
    }
    if (url.includes('/email')) {
      return mockJson({
        success: true,
        recipient: 'billing@abc.security',
        subject: 'Your PatrolSafe Licence – PEL-2026-000001',
        attachmentFilename: 'PEL-2026-000001.lic',
      });
    }
    return mockJson({});
  });

  render(
    <MemoryRouter>
      <AuthProvider>
        <IssueLicencePage />
      </AuthProvider>
    </MemoryRouter>,
  );

  await user.click(await screen.findByRole('option', { name: /ABC Security Ltd/ }));
  for (const _ of [1, 2, 3, 4]) {
    await user.click(screen.getByRole('button', { name: 'Continue' }));
  }
  await user.click(screen.getByLabelText(/I have reviewed the customer/i));
  await user.click(screen.getByRole('button', { name: 'Issue and sign licence' }));
  expect(await screen.findByText('Licence issued')).toBeInTheDocument();
}

function licenceDetailPayload() {
  return {
    id: 'lic-1',
    licenseId: 'PEL-2026-000001',
    customerId: 'cust-1',
    customerName: 'ABC Security Ltd',
    customerEmail: 'billing@abc.security',
    plan: 'ANNUAL',
    status: 'ACTIVE',
    effectiveStatus: 'ACTIVE',
    startsAt: '2026-07-21',
    expiresAt: '2027-07-20',
    maxDevices: 1,
    features: ['collector'],
    maskedLicenseKey: 'TG1.****.signature',
    updatedAt: '2026-07-21T00:00:00.000Z',
    notificationLogs: [
      {
        id: 'n1',
        notificationType: 'LICENSE_ISSUED',
        provider: 'EMAIL',
        recipient: 'billing@abc.security',
        subject: 'Your PatrolSafe Licence – PEL-2026-000001',
        status: 'SENT',
        attempts: 1,
        sentAt: '2026-07-21T10:00:00.000Z',
        errorMessage: null,
        createdAt: '2026-07-21T10:00:00.000Z',
        actorDisplayName: 'Portal Admin',
      },
      {
        id: 'n2',
        notificationType: 'LICENSE_ISSUED',
        provider: 'EMAIL',
        recipient: 'billing@abc.security',
        subject: 'Your PatrolSafe Licence – PEL-2026-000001',
        status: 'FAILED',
        attempts: 1,
        sentAt: null,
        errorMessage: 'SMTP is not configured',
        createdAt: '2026-07-21T11:00:00.000Z',
        actorDisplayName: 'Portal Admin',
      },
    ],
    auditLogs: [],
    installations: [],
    payments: [],
    renewals: [],
  };
}

describe('issue success email licence', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    seedAuth();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows Email licence, loads defaults, sends successfully, and never persists TG1', async () => {
    const user = userEvent.setup();
    await reachSuccessScreen(user);

    await user.click(screen.getByRole('button', { name: 'Email licence' }));
    expect(await screen.findByRole('heading', { name: 'Email licence' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('billing@abc.security')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('Your PatrolSafe Licence – PEL-2026-000001'),
    ).toBeInTheDocument();
    expect(screen.getByText('PEL-2026-000001.lic')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /Optional message/i }), 'Welcome aboard');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/Licence emailed successfully to billing@abc.security/i)).toBeInTheDocument();

    const emailCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/email'));
    expect(emailCall).toBeTruthy();
    const body = JSON.parse(String(emailCall?.[1]?.body ?? '{}'));
    expect(body.source).toBe('issue-success');
    expect(body.fullLicenseKey).toBe(TG1);
    expect(body.message).toBe('Welcome aboard');
    expect(JSON.stringify(localStorage)).not.toContain(TG1);
    expect(JSON.stringify(sessionStorage)).not.toContain(TG1);
  });

  it('shows safe failure with Retry and Download licence instead', async () => {
    const user = userEvent.setup();
    await reachSuccessScreen(user);

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/email')) {
        return mockJson({
          success: false,
          recipient: 'billing@abc.security',
          subject: 'Your PatrolSafe Licence – PEL-2026-000001',
          attachmentFilename: 'PEL-2026-000001.lic',
          errorMessage: 'SMTP is not configured',
          errorCode: 'NOTIFICATION_SMTP_NOT_CONFIGURED',
        });
      }
      return mockJson({});
    });

    await user.click(screen.getByRole('button', { name: 'Email licence' }));
    await user.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/SMTP is not configured/i)).toBeInTheDocument();
    expect(screen.getByText(/licence remains valid/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download licence instead' })).toBeInTheDocument();
  });
});

describe('licence detail email and notification history', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderDetail(role: AdminRole) {
    seedAuth(role);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.match(/\/admin\/licences\/lic-1$/) && (!init?.method || init.method === 'GET')) {
        return mockJson(licenceDetailPayload());
      }
      if (url.includes('/email')) {
        return mockJson({
          success: true,
          recipient: 'billing@abc.security',
          subject: 'Your PatrolSafe Licence – PEL-2026-000001',
          attachmentFilename: 'PEL-2026-000001.lic',
        });
      }
      return mockJson({});
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
  }

  it('shows Email licence for ADMIN and requires password', async () => {
    const user = userEvent.setup();
    renderDetail('ADMIN');

    expect(await screen.findByRole('button', { name: 'Email licence' })).toBeInTheDocument();
    expect(screen.getByText('Notification history')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('SMTP is not configured')).toBeInTheDocument();
    expect(screen.queryByText(TG1)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Email licence' }));
    const password = await screen.findByLabelText('Current password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await user.type(password, 'SecretPass1!');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Licence emailed successfully/i)).toBeInTheDocument();

    const emailCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/email'));
    const body = JSON.parse(String(emailCall?.[1]?.body ?? '{}'));
    expect(body.source).toBe('licence-detail');
    expect(body.password).toBe('SecretPass1!');
    expect(body.fullLicenseKey).toBeUndefined();
  });

  it('hides Email licence for SUPPORT', async () => {
    renderDetail('SUPPORT');
    expect(await screen.findByText('PEL-2026-000001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email licence' })).not.toBeInTheDocument();
    expect(screen.getByText('Notification history')).toBeInTheDocument();
  });

  it('clears password when modal closes', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <EmailLicenceModal
            licenceId="lic-1"
            humanLicenseId="PEL-2026-000001"
            defaultRecipient="billing@abc.security"
            defaultSubject="Your PatrolSafe Licence – PEL-2026-000001"
            accessToken="access-token"
            source="licence-detail"
            requirePassword
            onClose={() => undefined}
            onSent={() => undefined}
          />
        </AuthProvider>
      </MemoryRouter>,
    );

    seedAuth();
    const password = await screen.findByLabelText('Current password');
    await user.type(password, 'SecretPass1!');
    expect(password).toHaveValue('SecretPass1!');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByDisplayValue('SecretPass1!')).not.toBeInTheDocument();
    });
  });

  it('prevents double submission', async () => {
    const user = userEvent.setup();
    let resolveRequest: ((value: ReturnType<typeof mockJson>) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<ReturnType<typeof mockJson>>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    seedAuth();
    render(
      <MemoryRouter>
        <AuthProvider>
          <EmailLicenceModal
            licenceId="lic-1"
            humanLicenseId="PEL-2026-000001"
            defaultRecipient="billing@abc.security"
            defaultSubject="Subject"
            accessToken="access-token"
            source="licence-detail"
            requirePassword
            onClose={() => undefined}
            onSent={() => undefined}
          />
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.type(await screen.findByLabelText('Current password'), 'SecretPass1!');
    const sendButton = screen.getByRole('button', { name: 'Send' });
    await user.click(sendButton);
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled();
    await user.click(sendButton);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveRequest?.(
      mockJson({
        success: true,
        recipient: 'billing@abc.security',
        subject: 'Subject',
        attachmentFilename: 'PEL-2026-000001.lic',
      }),
    );
  });
});
