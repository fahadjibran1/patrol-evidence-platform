import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import {
  buildActivationInstructions,
  buildLicenceFileContents,
  buildLicenceFilename,
  downloadLicenceFile,
  LICENCE_FILE_MIME,
} from '../lib/licence-file';
import { ISSUE_WIZARD_STORAGE_KEY } from '../lib/issue-wizard-state';
import { DownloadLicenceModal } from '../components/download-licence-modal';
import { IssueLicencePage } from '../pages/issue-licence-page';
import { LicenceDetailPage } from '../pages/licence-detail-page';
import type { AdminRole } from '../types';

const fetchMock = vi.fn();

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

const TG1 = 'TG1.abc.payload.signature';

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
    if (url.includes('/download-event')) {
      return mockJson({ recorded: true, deduplicated: false });
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

function stubLicenceDownloadApis() {
  const OriginalBlob = globalThis.Blob;
  const blobCalls: Array<{ parts: unknown[]; type: string }> = [];
  const createObjectURL = vi.fn(() => 'blob:mock-url');
  const revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

  vi.stubGlobal(
    'Blob',
    class extends OriginalBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts ?? [], options);
        blobCalls.push({ parts: parts ?? [], type: options?.type ?? '' });
      }
    },
  );
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL,
    revokeObjectURL,
  });

  return { blobCalls, createObjectURL, revokeObjectURL, click };
}

describe('licence file helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds filename and exact TG1 contents with trailing newline', () => {
    expect(buildLicenceFilename('PEL-2026-000001')).toBe('PEL-2026-000001.lic');
    expect(buildLicenceFileContents(TG1)).toBe(`${TG1}\n`);
  });

  it('excludes TG1 from activation instructions', () => {
    const text = buildActivationInstructions({
      licenseId: 'PEL-2026-000001',
      companyName: 'ABC Security Ltd',
      plan: 'ANNUAL',
      expiresAtDisplay: '20/07/2027',
    });
    expect(text).toContain('PEL-2026-000001');
    expect(text).toContain('ABC Security Ltd');
    expect(text).not.toContain('TG1.');
    expect(text).not.toContain(TG1);
  });

  it('downloads with correct MIME type and revokes blob URL', () => {
    const { blobCalls, createObjectURL, revokeObjectURL, click } = stubLicenceDownloadApis();

    const result = downloadLicenceFile('PEL-2026-000001', TG1);

    expect(result.fileName).toBe('PEL-2026-000001.lic');
    expect(result.mimeType).toBe(LICENCE_FILE_MIME);
    expect(result.revoked).toBe(true);
    expect(blobCalls[0]).toEqual({ parts: [`${TG1}\n`], type: LICENCE_FILE_MIME });
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(JSON.stringify(localStorage)).not.toContain(TG1);
    expect(JSON.stringify(sessionStorage)).not.toContain(TG1);
  });
});

describe('issue success download', () => {
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

  it('shows download button and downloads without persisting the key', async () => {
    const user = userEvent.setup();
    await reachSuccessScreen(user);

    const downloadButton = screen.getByRole('button', { name: 'Download licence file' });
    expect(downloadButton).toBeEnabled();
    expect(screen.getByText(/Store this file securely/i)).toBeInTheDocument();

    const { blobCalls, revokeObjectURL } = stubLicenceDownloadApis();
    await user.click(downloadButton);

    expect(await screen.findByText('PEL-2026-000001.lic downloaded.')).toBeInTheDocument();
    expect(blobCalls[0]).toEqual({ parts: [`${TG1}\n`], type: LICENCE_FILE_MIME });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(JSON.stringify(localStorage)).not.toContain(TG1);
    expect(JSON.stringify(sessionStorage)).not.toContain(TG1);
    expect(sessionStorage.getItem(ISSUE_WIZARD_STORAGE_KEY)).toBeNull();
  });

  it('disables download when full TG1 key is missing', async () => {
    const user = userEvent.setup();
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
            plan: 'ANNUAL',
            status: 'ACTIVE',
            startsAt: '2026-07-21',
            expiresAt: '2027-07-20',
            maxDevices: 1,
            features: ['collector'],
            updatedAt: '2026-07-21T00:00:00.000Z',
          },
          // Present in memory but not a TG1 key — download must stay disabled.
          fullLicenseKey: 'INVALID.KEY',
          licenseKey: 'INVALID.KEY',
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
    expect(screen.getByRole('button', { name: 'Download licence file' })).toBeDisabled();
  });
});

describe('licence detail download modal', () => {
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
        return mockJson({
          id: 'lic-1',
          licenseId: 'PEL-2026-000001',
          customerId: 'cust-1',
          customerName: 'ABC Security Ltd',
          plan: 'ANNUAL',
          status: 'ACTIVE',
          effectiveStatus: 'ACTIVE',
          startsAt: '2026-07-21',
          expiresAt: '2027-07-20',
          maxDevices: 1,
          features: ['collector'],
          maskedKey: 'TG1.****.****',
          maskedLicenseKey: 'TG1.****.****',
          installations: [],
          payments: [],
          renewals: [],
          auditLogs: [],
          updatedAt: '2026-07-21T00:00:00.000Z',
        });
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

  it('hides download action for SUPPORT', async () => {
    renderDetail('SUPPORT');
    expect(await screen.findByText('PEL-2026-000001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download licence file' })).not.toBeInTheDocument();
  });

  it('requires password reconfirmation and downloads on successful reveal', async () => {
    const user = userEvent.setup();
    renderDetail('ADMIN');
    expect(await screen.findByRole('button', { name: 'Download licence file' })).toBeInTheDocument();

    const { revokeObjectURL } = stubLicenceDownloadApis();

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.match(/\/admin\/licences\/lic-1$/) && (!init?.method || init.method === 'GET')) {
        return mockJson({
          id: 'lic-1',
          licenseId: 'PEL-2026-000001',
          customerId: 'cust-1',
          customerName: 'ABC Security Ltd',
          plan: 'ANNUAL',
          status: 'ACTIVE',
          effectiveStatus: 'ACTIVE',
          startsAt: '2026-07-21',
          expiresAt: '2027-07-20',
          maxDevices: 1,
          features: ['collector'],
          maskedKey: 'TG1.****.****',
          installations: [],
          payments: [],
          renewals: [],
          auditLogs: [],
          updatedAt: '2026-07-21T00:00:00.000Z',
        });
      }
      if (url.includes('/reveal') && init?.method === 'POST') {
        return mockJson({
          licenseId: 'PEL-2026-000001',
          signedLicenseKey: TG1,
          fullLicenseKey: TG1,
        });
      }
      if (url.includes('/download-event')) {
        return mockJson({ recorded: true, deduplicated: false });
      }
      return mockJson({});
    });

    await user.click(screen.getByRole('button', { name: 'Download licence file' }));
    expect(await screen.findByRole('dialog', { name: /Download full licence/i })).toBeInTheDocument();
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(password).toHaveFocus();

    await user.type(password, 'CorrectPassword1!');
    await user.click(screen.getByRole('button', { name: 'Confirm and download' }));

    expect(await screen.findByText('PEL-2026-000001.lic downloaded.')).toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(JSON.stringify(localStorage)).not.toContain(TG1);
    expect(JSON.stringify(sessionStorage)).not.toContain(TG1);
  });

  it('shows safe error on failed reveal and clears password on close', async () => {
    const user = userEvent.setup();
    renderDetail('SUPER_ADMIN');
    await user.click(await screen.findByRole('button', { name: 'Download licence file' }));

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/reveal') && init?.method === 'POST') {
        return mockJson(
          { code: 'LICENCE_REVEAL_PASSWORD_INVALID', message: 'Invalid password' },
          { ok: false, status: 401 },
        );
      }
      if (url.match(/\/admin\/licences\/lic-1$/)) {
        return mockJson({
          id: 'lic-1',
          licenseId: 'PEL-2026-000001',
          customerId: 'cust-1',
          customerName: 'ABC Security Ltd',
          plan: 'ANNUAL',
          status: 'ACTIVE',
          effectiveStatus: 'ACTIVE',
          startsAt: '2026-07-21',
          expiresAt: '2027-07-20',
          maxDevices: 1,
          features: ['collector'],
          maskedKey: 'TG1.****.****',
          installations: [],
          payments: [],
          renewals: [],
          auditLogs: [],
          updatedAt: '2026-07-21T00:00:00.000Z',
        });
      }
      return mockJson({});
    });

    await user.type(screen.getByLabelText('Password'), 'WrongPassword');
    await user.click(screen.getByRole('button', { name: 'Confirm and download' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid password/i);
    expect(screen.getByLabelText('Password')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prevents double submission while verifying', async () => {
    const user = userEvent.setup();
    const deferred: { resolve?: (value: ReturnType<typeof mockJson>) => void } = {};

    render(
      <DownloadLicenceModal
        licenceId="lic-1"
        humanLicenseId="PEL-2026-000001"
        accessToken="access-token"
        onClose={() => undefined}
        onDownloaded={() => undefined}
      />,
    );

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/reveal')) {
        return new Promise((resolve) => {
          deferred.resolve = resolve;
        });
      }
      return mockJson({});
    });

    await user.type(screen.getByLabelText('Password'), 'CorrectPassword1!');
    const confirm = screen.getByRole('button', { name: 'Confirm and download' });
    await user.click(confirm);
    await user.click(confirm);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Verifying…' })).toBeDisabled());
    const revealCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/reveal'));
    expect(revealCalls).toHaveLength(1);

    deferred.resolve?.(mockJson({ licenseId: 'PEL-2026-000001', fullLicenseKey: TG1 }));
  });
});
