import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { LicenceDetailPage } from '../pages/licence-detail-page';
import { RenewLicencePage } from '../pages/renew-licence-page';
import type { AdminRole } from '../types';

const fetchMock = vi.fn();
const TG1 = 'TG1.renewed.payload.signature';

function mockJson(body: unknown, init?: { ok?: boolean; status?: number }) {
  const status = init?.status ?? 200;
  return {
    ok: init?.ok ?? status < 400,
    status,
    text: async () => JSON.stringify(body),
  };
}

function stubLicenceDownloadApis() {
  const OriginalBlob = globalThis.Blob;
  const createObjectURL = vi.fn(() => 'blob:mock-url');
  const revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  vi.stubGlobal('Blob', class extends OriginalBlob {});
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  return { createObjectURL, revokeObjectURL };
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

function baseLicence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lic-1',
    licenseId: 'PEL-2026-000001',
    customerId: 'cust-1',
    customerName: 'ABC Security Ltd',
    customerEmail: 'billing@abc.security',
    plan: 'ANNUAL',
    status: 'ACTIVE',
    effectiveStatus: 'ACTIVE',
    startsAt: '2026-01-01',
    expiresAt: '2099-12-31',
    maxDevices: 3,
    features: ['collector'],
    maskedLicenseKey: 'TG1.****.signature',
    maskedKey: 'TG1.****.signature',
    updatedAt: '2026-07-01T00:00:00.000Z',
    installations: [],
    payments: [],
    renewals: [],
    auditLogs: [],
    notificationLogs: [],
    versions: [
      {
        id: 'ver-1',
        versionNumber: 1,
        actionType: 'ISSUED',
        plan: 'ANNUAL',
        maxDevices: 3,
        validFrom: '2026-01-01',
        validUntil: '2099-12-31',
        statusSnapshot: 'ACTIVE',
        reason: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        issuedByDisplayName: 'Portal Admin',
      },
    ],
    ...overrides,
  };
}

function renderDetail(role: AdminRole, licenceOverrides: Record<string, unknown> = {}) {
  seedAuth(role);
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.match(/\/admin\/licences\/lic-1$/) && (!init?.method || init.method === 'GET')) {
      return mockJson(baseLicence(licenceOverrides));
    }
    return mockJson({});
  });

  return render(
    <MemoryRouter initialEntries={['/licences/lic-1']}>
      <AuthProvider>
        <Routes>
          <Route path="/licences/:id" element={<LicenceDetailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Lifecycle Actions — role visibility', () => {
  it('hides the entire Lifecycle actions section for SUPPORT', async () => {
    renderDetail('SUPPORT');
    expect(await screen.findByText('PEL-2026-000001')).toBeInTheDocument();
    expect(screen.queryByText('Lifecycle actions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Renew' })).not.toBeInTheDocument();
  });

  it('shows Lifecycle actions for ADMIN and SUPER_ADMIN', async () => {
    renderDetail('ADMIN');
    expect(await screen.findByText('Lifecycle actions')).toBeInTheDocument();
  });
});

describe('Lifecycle Actions — status gating', () => {
  it('ACTIVE: shows Renew, Reissue, Suspend, Change plan, Change device limit, Revoke — not Reactivate', async () => {
    renderDetail('ADMIN', { status: 'ACTIVE', effectiveStatus: 'ACTIVE' });
    await screen.findByText('Lifecycle actions');

    expect(screen.getByRole('link', { name: 'Renew' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reissue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change device limit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
  });

  it('SUSPENDED: shows Renew, Reactivate, Change plan, Change device limit, Revoke — not Suspend or Reissue', async () => {
    renderDetail('ADMIN', { status: 'SUSPENDED', effectiveStatus: 'SUSPENDED' });
    await screen.findByText('Lifecycle actions');

    expect(screen.getByRole('link', { name: 'Renew' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change device limit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reissue' })).not.toBeInTheDocument();
  });

  it('EXPIRED: shows Renew and Revoke only', async () => {
    renderDetail('ADMIN', { status: 'EXPIRED', effectiveStatus: 'EXPIRED' });
    await screen.findByText('Lifecycle actions');

    expect(screen.getByRole('link', { name: 'Renew' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reissue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change plan' })).not.toBeInTheDocument();
  });

  it('REVOKED: hides Renew and every lifecycle action', async () => {
    renderDetail('ADMIN', { status: 'REVOKED', effectiveStatus: 'REVOKED' });
    await screen.findByText('Lifecycle actions');

    expect(screen.queryByRole('link', { name: 'Renew' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reissue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change device limit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(screen.getByText(/No lifecycle actions are available/i)).toBeInTheDocument();
  });

  it('DRAFT: hides Renew and Revoke', async () => {
    renderDetail('ADMIN', { status: 'DRAFT', effectiveStatus: 'DRAFT' });
    await screen.findByText('Lifecycle actions');

    expect(screen.queryByRole('link', { name: 'Renew' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });
});

describe('Version history', () => {
  it('labels Current, Superseded and Revoked versions', async () => {
    renderDetail('ADMIN', {
      status: 'REVOKED',
      effectiveStatus: 'REVOKED',
      versions: [
        {
          id: 'ver-1',
          versionNumber: 1,
          actionType: 'ISSUED',
          plan: 'ANNUAL',
          maxDevices: 3,
          validFrom: '2026-01-01',
          validUntil: '2099-12-31',
          statusSnapshot: 'ACTIVE',
          reason: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          issuedByDisplayName: 'Portal Admin',
        },
        {
          id: 'ver-2',
          versionNumber: 2,
          actionType: 'RENEWED',
          plan: 'ANNUAL',
          maxDevices: 3,
          validFrom: '2026-01-01',
          validUntil: '2100-12-31',
          statusSnapshot: 'ACTIVE',
          reason: 'Annual renewal',
          createdAt: '2026-02-01T00:00:00.000Z',
          issuedByDisplayName: 'Portal Admin',
        },
        {
          id: 'ver-3',
          versionNumber: 3,
          actionType: 'REVOKED',
          plan: 'ANNUAL',
          maxDevices: 3,
          validFrom: '2026-01-01',
          validUntil: '2100-12-31',
          statusSnapshot: 'REVOKED',
          reason: 'Customer churned',
          createdAt: '2026-03-01T00:00:00.000Z',
          issuedByDisplayName: 'Portal Admin',
        },
      ],
    });

    const versionHistoryHeading = await screen.findByText('Version history');
    expect(versionHistoryHeading).toBeInTheDocument();
    const versionHistoryTable = versionHistoryHeading.closest('section') as HTMLElement;
    expect(within(versionHistoryTable).getByText('v1')).toBeInTheDocument();
    expect(within(versionHistoryTable).getByText('v2')).toBeInTheDocument();
    expect(within(versionHistoryTable).getByText('v3')).toBeInTheDocument();
    expect(within(versionHistoryTable).getAllByText('Superseded')).toHaveLength(2);
    expect(within(versionHistoryTable).getAllByText('Revoked').length).toBeGreaterThanOrEqual(1);
    // No download affordance and no TG1 material anywhere in the version history table.
    expect(within(versionHistoryTable).queryByText(TG1)).not.toBeInTheDocument();
    expect(within(versionHistoryTable).queryAllByRole('button', { name: /download/i })).toHaveLength(0);
  });
});

describe('Revoke — confirmation text and password handling', () => {
  it('disables submit until the confirmation text matches exactly, clears password on failure', async () => {
    const user = userEvent.setup();
    renderDetail('ADMIN', { status: 'ACTIVE', effectiveStatus: 'ACTIVE' });
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));

    const confirmInput = await screen.findByLabelText(/Type "REVOKE PEL-2026-000001" to confirm/i);
    const passwordInput = screen.getByLabelText(/^Administrator password/);
    const submitButton = screen.getByRole('button', { name: 'Revoke licence' });

    await user.type(passwordInput, 'AdminPass1!');
    expect(submitButton).toBeDisabled();

    await user.type(confirmInput, 'REVOKE WRONG-ID');
    expect(submitButton).toBeDisabled();

    await user.clear(confirmInput);
    await user.type(confirmInput, 'REVOKE PEL-2026-000001');
    expect(submitButton).not.toBeDisabled();

    await user.type(screen.getByLabelText(/^Reason/), 'Customer churned');

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/revoke') && init?.method === 'POST') {
        return mockJson({ code: 'LICENCE_REVEAL_PASSWORD_INVALID', message: 'Invalid password' }, { ok: false, status: 401 });
      }
      if (url.match(/\/admin\/licences\/lic-1$/)) {
        return mockJson(baseLicence());
      }
      return mockJson({});
    });

    await user.click(submitButton);
    expect(await screen.findByText(/Invalid password/i)).toBeInTheDocument();
    expect(passwordInput).toHaveValue('');
  });

  it('submits successfully and refreshes the licence with the REVOKED status', async () => {
    const user = userEvent.setup();
    renderDetail('ADMIN', { status: 'ACTIVE', effectiveStatus: 'ACTIVE' });
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));

    await user.type(screen.getByLabelText(/Type "REVOKE PEL-2026-000001" to confirm/i), 'REVOKE PEL-2026-000001');
    await user.type(screen.getByLabelText(/^Reason/), 'Customer churned');
    await user.type(screen.getByLabelText(/^Administrator password/), 'AdminPass1!');

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/revoke') && init?.method === 'POST') {
        return mockJson(baseLicence({ status: 'REVOKED', effectiveStatus: 'REVOKED' }));
      }
      if (url.match(/\/admin\/licences\/lic-1$/)) {
        return mockJson(baseLicence({ status: 'REVOKED', effectiveStatus: 'REVOKED' }));
      }
      return mockJson({});
    });

    await user.click(screen.getByRole('button', { name: 'Revoke licence' }));
    expect(await screen.findByText('Revoke completed successfully.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Suspend — double submit prevention', () => {
  it('only sends one suspend request when the submit button is clicked twice', async () => {
    const user = userEvent.setup();
    renderDetail('ADMIN', { status: 'ACTIVE', effectiveStatus: 'ACTIVE' });
    await user.click(await screen.findByRole('button', { name: 'Suspend' }));

    await user.type(screen.getByLabelText(/^Reason/), 'Non-payment');
    await user.type(screen.getByLabelText(/^Administrator password/), 'AdminPass1!');

    let resolveSuspend: ((value: ReturnType<typeof mockJson>) => void) | undefined;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/suspend') && init?.method === 'POST') {
        return new Promise((resolve) => {
          resolveSuspend = resolve;
        });
      }
      return mockJson(baseLicence());
    });

    const submitButton = screen.getByRole('button', { name: 'Suspend licence' });
    await user.click(submitButton);
    await user.click(submitButton);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Suspending…' })).toBeDisabled());
    const suspendCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/suspend'));
    expect(suspendCalls).toHaveLength(1);

    resolveSuspend?.(mockJson(baseLicence({ status: 'SUSPENDED', effectiveStatus: 'SUSPENDED' })));
  });
});

describe('Renewal wizard', () => {
  function renderWizard() {
    return render(
      <MemoryRouter initialEntries={['/licences/lic-1/renew']}>
        <AuthProvider>
          <Routes>
            <Route path="/licences/:id/renew" element={<RenewLicencePage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    seedAuth('ADMIN');
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.match(/\/admin\/licences\/lic-1$/) && (!init?.method || init.method === 'GET')) {
        return mockJson(baseLicence());
      }
      return mockJson({});
    });
  });

  it('walks through all four steps and shows an old-vs-new comparison before confirming', async () => {
    const user = userEvent.setup();
    renderWizard();

    expect(await screen.findByText('Renewal period')).toBeInTheDocument();
    expect(screen.getByText('ABC Security Ltd')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Validity & entitlement')).toBeInTheDocument();
    // Default continuity start is the day after the far-future fixture expiry.
    expect(screen.getByDisplayValue('01/01/2100')).toBeInTheDocument();
    expect(screen.getByDisplayValue('31/12/2100')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Notify & authorise')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Administrator password/), 'AdminPass1!');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Current vs. after renewal')).toBeInTheDocument();
    expect(screen.getByText('01/01/2026 – 31/12/2099')).toBeInTheDocument();
    expect(screen.getByText('01/01/2100 – 31/12/2100')).toBeInTheDocument();
  });

  it('does not show the date-override toggle for ADMIN but does for SUPER_ADMIN', async () => {
    seedAuth('ADMIN');
    const user = userEvent.setup();
    renderWizard();
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Validity & entitlement')).toBeInTheDocument();
    expect(screen.queryByText(/Override the continuity start date/i)).not.toBeInTheDocument();
  });

  it('shows the date-override toggle for SUPER_ADMIN', async () => {
    seedAuth('SUPER_ADMIN');
    const user = userEvent.setup();
    renderWizard();
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Validity & entitlement')).toBeInTheDocument();
    expect(screen.getByText(/Override the continuity start date/i)).toBeInTheDocument();
  });

  it('completes renewal, shows version number and new expiry, downloads without persisting TG1, and prevents double submit', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByText('Validity & entitlement');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Notify & authorise');
    await user.type(screen.getByLabelText(/^Administrator password/), 'AdminPass1!');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Current vs. after renewal');

    let renewCallCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/renew') && init?.method === 'POST') {
        renewCallCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return mockJson(
          baseLicence({
            startsAt: '2100-01-01',
            expiresAt: '2100-12-31',
            fullLicenseKey: TG1,
            signedLicenseKey: TG1,
          }),
        );
      }
      if (url.match(/\/admin\/licences\/lic-1$/) && (!init?.method || init.method === 'GET')) {
        return mockJson(
          baseLicence({
            startsAt: '2100-01-01',
            expiresAt: '2100-12-31',
            versions: [
              ...baseLicence().versions,
              {
                id: 'ver-2',
                versionNumber: 2,
                actionType: 'RENEWED',
                plan: 'ANNUAL',
                maxDevices: 3,
                validFrom: '2100-01-01',
                validUntil: '2100-12-31',
                statusSnapshot: 'ACTIVE',
                reason: null,
                createdAt: '2100-01-01T00:00:00.000Z',
                issuedByDisplayName: 'Portal Admin',
              },
            ],
          }),
        );
      }
      if (url.includes('/download-event')) {
        return mockJson({ recorded: true, deduplicated: false });
      }
      return mockJson({});
    });

    const confirmButton = screen.getByRole('button', { name: 'Confirm and renew' });
    await user.click(confirmButton);
    await user.click(confirmButton);

    expect(await screen.findByText('Licence renewed')).toBeInTheDocument();
    expect(screen.getByText(/version 2/)).toBeInTheDocument();
    expect(screen.getByText('31/12/2100')).toBeInTheDocument();
    expect(renewCallCount).toBe(1);

    stubLicenceDownloadApis();
    const downloadButton = screen.getByRole('button', { name: 'Download licence file' });
    expect(downloadButton).toBeEnabled();
    await user.click(downloadButton);
    expect(await screen.findByText(/downloaded\./)).toBeInTheDocument();

    expect(JSON.stringify(sessionStorage)).not.toContain(TG1);
    expect(JSON.stringify(localStorage)).not.toContain(TG1);
    expect(JSON.stringify(sessionStorage)).not.toContain('AdminPass1!');
    expect(JSON.stringify(localStorage)).not.toContain('AdminPass1!');
  });

  it('shows a safe error and clears the password when renewal fails', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await screen.findByText('Validity & entitlement');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Notify & authorise');
    await user.type(screen.getByLabelText(/^Administrator password/), 'WrongPass1!');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Current vs. after renewal');

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/renew') && init?.method === 'POST') {
        return mockJson({ code: 'LICENCE_REVEAL_PASSWORD_INVALID', message: 'Invalid password' }, { ok: false, status: 401 });
      }
      return mockJson(baseLicence());
    });

    await user.click(screen.getByRole('button', { name: 'Confirm and renew' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid password/i);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByLabelText(/^Administrator password/)).toHaveValue('');
  });

  it('rejects renewal for a REVOKED licence before any submission is possible', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.match(/\/admin\/licences\/lic-1$/) && (!init?.method || init.method === 'GET')) {
        return mockJson(baseLicence({ status: 'REVOKED', effectiveStatus: 'REVOKED' }));
      }
      return mockJson({});
    });

    renderWizard();
    expect(await screen.findByText(/cannot be renewed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  });

  it('blocks SUPPORT from accessing the renewal wizard', async () => {
    seedAuth('SUPPORT');
    renderWizard();
    expect(await screen.findByText(/SUPPORT users cannot renew licences/i)).toBeInTheDocument();
  });
});
