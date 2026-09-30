import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  COMMERCIAL_PURCHASE_ATTEMPT_TIMEOUT_MS,
  COMMERCIAL_PURCHASE_MAX_ATTEMPTS,
  COMMERCIAL_PURCHASE_RETRY_DELAY_MS,
  CommercialPurchaseClientService,
} from './commercial-purchase-client.service';
import { InstallationIdentityService } from './installation-identity.service';

describe('CommercialPurchaseClientService', () => {
  const previousEnv = { ...process.env };
  let root: string;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'commercial-purchase-client-'));
    const configPath = path.join(root, 'workspace-config.json');
    writeFileSync(configPath, JSON.stringify({ companyName: 'Example Patrol Ltd' }));
    process.env.DESKTOP_CONFIG_PATH = configPath;
    process.env.PATROL_LICENSE_DATA_ROOT = root;
    process.env.PATROL_LICENSE_TEST_MODE = 'true';
    process.env.NODE_ENV = 'test';
    process.env.PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN = 'http://127.0.0.1:47821';
    process.env.PATROLSAFE_COMMERCIAL_PURCHASE_ORIGIN = 'https://www.sfour.co.uk';
    process.env.PATROL_APP_VERSION = '1.0.3';
    process.env.PATROL_BUILD_ID = 'phase5-test';
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    process.env = { ...previousEnv };
    rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function service(): CommercialPurchaseClientService {
    return new CommercialPurchaseClientService(new InstallationIdentityService());
  }

  function captureDiagnostics(candidate: CommercialPurchaseClientService): {
    lines: string[];
  } {
    const lines: string[] = [];
    const logger = (candidate as unknown as {
      logger: { log: (message: string) => void; warn: (message: string) => void };
    }).logger;
    jest.spyOn(logger, 'log').mockImplementation((message) => { lines.push(message); });
    jest.spyOn(logger, 'warn').mockImplementation((message) => { lines.push(message); });
    return { lines };
  }

  it('submits exact PurchaseRequestV2 without desktop price authority and returns an S4 opaque URL', async () => {
    const requestId = '5c97ec6e-77af-4fbe-8928-6ba4931eb213';
    const reference = 'A'.repeat(43);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ requestId, publicOrderId: 'ord_74cc812c-4abf-4f06-a57e-3a4c1ad6ce27', purchaseReference: reference, referenceExpiresAt: '2026-09-22T14:00:00.000Z', status: 'REQUEST_CREATED' }) });
    const result = await service().start({ requestId, clientNonce: 'n'.repeat(32) });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ requestId, schemaVersion: 2, product: 'Patrol Evidence Platform', plan: 'annual', companyName: 'Example Patrol Ltd', appVersion: '1.0.3', buildId: 'phase5-test' });
    expect(body).not.toHaveProperty('amount');
    expect(body).not.toHaveProperty('currency');
    expect(body).not.toHaveProperty('stripePriceId');
    expect(result.purchaseUrl).toBe(`https://www.sfour.co.uk/patrolsafe/buy/${reference}`);
    expect(result.purchaseUrl).not.toContain(body.installationId);
    expect(result.purchaseUrl).not.toContain(body.machineFingerprint);
  });

  it('includes only previousLicenceId as renewal context and never calculates dates', async () => {
    const requestId = 'b2e3d7f7-1dc8-40c1-86cf-e8ad1c371bcc';
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ requestId, publicOrderId: 'ord_5bb15ad8-9ce5-4e8e-ae9a-1ac332ec149f', purchaseReference: 'B'.repeat(43), referenceExpiresAt: '2026-09-22T14:00:00.000Z', status: 'REQUEST_CREATED' }) });
    await service().start({ requestId, clientNonce: 'r'.repeat(32), previousLicenceId: 'lic-68bab50b-8d75-424c-bd3a-54d33b7e6595' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.previousLicenceId).toMatch(/^lic-/);
    expect(body).not.toHaveProperty('startsAt');
    expect(body).not.toHaveProperty('expiresAt');
  });

  it.each([
    ['REQUEST_CREATED', 'AWAITING_PAYMENT'],
    ['PAYMENT_PENDING', 'AWAITING_PAYMENT'],
    ['PAID_AWAITING_APPROVAL', 'AWAITING_APPROVAL'],
    ['ISSUANCE_PENDING', 'PREPARING'],
    ['DELIVERY_PENDING', 'READY'],
    ['FAILED', 'DELIVERY_PROBLEM'],
  ])('maps %s to customer-safe status %s', async (orderState, expected) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ orderState }) });
    await expect(service().status('C'.repeat(43))).resolves.toMatchObject({ status: expected });
  });

  it('fails closed when configuration is absent and does not alter local entitlement', async () => {
    delete process.env.PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN;
    await expect(service().start({ requestId: '5c97ec6e-77af-4fbe-8928-6ba4931eb213', clientNonce: 'n'.repeat(32) })).rejects.toThrow(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed service responses', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ purchaseReference: 'leaked' }) });
    const candidate = service();
    const { lines } = captureDiagnostics(candidate);
    await expect(candidate.start({ requestId: '5c97ec6e-77af-4fbe-8928-6ba4931eb213', clientNonce: 'n'.repeat(32) })).rejects.toThrow(/invalid purchase response/i);
    expect(lines).toContain('COMMERCIAL_PURCHASE_DIAGNOSTIC stage=COMMERCIAL_RESPONSE_VALIDATION_STARTED');
    expect(lines).toContain('COMMERCIAL_PURCHASE_DIAGNOSTIC stage=COMMERCIAL_RESPONSE_VALIDATION_FAILED errorClass=HTTP_EXCEPTION errorCode=HTTP_502');
    expect(lines.join(' ')).not.toContain('leaked');
  });

  it('identifies request construction failure before any outbound request', async () => {
    delete process.env.PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN;
    const candidate = service();
    const { lines } = captureDiagnostics(candidate);
    await expect(candidate.start({ requestId: '5c97ec6e-77af-4fbe-8928-6ba4931eb213', clientNonce: 'n'.repeat(32) })).rejects.toThrow(/not configured/i);
    expect(lines).toEqual([
      'COMMERCIAL_PURCHASE_DIAGNOSTIC stage=PURCHASE_REQUEST_V2_BUILD_STARTED',
      'COMMERCIAL_PURCHASE_DIAGNOSTIC stage=PURCHASE_REQUEST_V2_BUILD_FAILED errorClass=HTTP_EXCEPTION errorCode=HTTP_503',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('identifies outbound network failure without logging request secrets', async () => {
    fetchMock.mockRejectedValue(Object.assign(new TypeError('request body contained secret values'), { code: 'ECONNRESET' }));
    const candidate = service();
    const { lines } = captureDiagnostics(candidate);
    const requestId = '5c97ec6e-77af-4fbe-8928-6ba4931eb213';
    const clientNonce = 'SENSITIVE_NONCE_12345678901234567';
    await expect(candidate.start({ requestId, clientNonce })).rejects.toThrow(/temporarily unavailable/i);
    expect(lines).toContain('COMMERCIAL_PURCHASE_DIAGNOSTIC stage=RENDER_PURCHASE_REQUEST_STARTED');
    expect(lines).toContain('COMMERCIAL_PURCHASE_DIAGNOSTIC stage=RENDER_PURCHASE_REQUEST_RETRY_SCHEDULED attempt=1 maxAttempts=2 nextAttempt=2 delayMs=750 errorClass=TYPE_ERROR errorCode=ECONNRESET');
    expect(lines).toContain('COMMERCIAL_PURCHASE_DIAGNOSTIC stage=RENDER_PURCHASE_REQUEST_FAILED attempt=2 maxAttempts=2 errorClass=TYPE_ERROR errorCode=ECONNRESET');
    expect(fetchMock).toHaveBeenCalledTimes(COMMERCIAL_PURCHASE_MAX_ATTEMPTS);
    expect(lines.join(' ')).not.toContain(requestId);
    expect(lines.join(' ')).not.toContain(clientNonce);
    expect(lines.join(' ')).not.toContain('request body');
  });

  it('uses a finite timeout and identifies the final abort after one bounded retry', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockImplementation((_url: URL, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('sensitive timeout details');
          error.name = 'AbortError';
          reject(error);
        });
      }));
      const candidate = service();
      const { lines } = captureDiagnostics(candidate);
      const purchase = candidate.start({
        requestId: '5c97ec6e-77af-4fbe-8928-6ba4931eb213',
        clientNonce: 'n'.repeat(32),
      });
      const rejection = expect(purchase).rejects.toThrow(/temporarily unavailable/i);
      await jest.advanceTimersByTimeAsync(
        (COMMERCIAL_PURCHASE_ATTEMPT_TIMEOUT_MS * COMMERCIAL_PURCHASE_MAX_ATTEMPTS)
          + COMMERCIAL_PURCHASE_RETRY_DELAY_MS,
      );
      await rejection;
      expect(fetchMock).toHaveBeenCalledTimes(COMMERCIAL_PURCHASE_MAX_ATTEMPTS);
      expect(lines).toContain('COMMERCIAL_PURCHASE_DIAGNOSTIC stage=RENDER_PURCHASE_REQUEST_RETRY_SCHEDULED attempt=1 maxAttempts=2 nextAttempt=2 delayMs=750 errorClass=ABORT_ERROR errorCode=ABORT_ERR');
      expect(lines).toContain('COMMERCIAL_PURCHASE_DIAGNOSTIC stage=RENDER_PURCHASE_REQUEST_FAILED attempt=2 maxAttempts=2 errorClass=ABORT_ERROR errorCode=ABORT_ERR');
      expect(lines.join(' ')).not.toContain('sensitive timeout details');
    } finally {
      jest.useRealTimers();
    }
  });

  it('allows a valid response delayed beyond the former ten-second boundary', async () => {
    jest.useFakeTimers();
    try {
      const requestId = '5c97ec6e-77af-4fbe-8928-6ba4931eb213';
      fetchMock.mockImplementation(() => new Promise((resolve) => {
        setTimeout(() => resolve({
          ok: true,
          status: 201,
          json: async () => ({
            requestId,
            publicOrderId: 'ord_74cc812c-4abf-4f06-a57e-3a4c1ad6ce27',
            purchaseReference: 'D'.repeat(43),
            referenceExpiresAt: '2026-09-25T14:00:00.000Z',
            status: 'REQUEST_CREATED',
          }),
        }), 12_000);
      }));
      const purchase = service().start({ requestId, clientNonce: 'n'.repeat(32) });
      await jest.advanceTimersByTimeAsync(12_000);
      await expect(purchase).resolves.toMatchObject({ status: 'PURCHASE_STARTED' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries a transient HTTP failure once with the identical request identity and body', async () => {
    const requestId = '5c97ec6e-77af-4fbe-8928-6ba4931eb213';
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          requestId,
          publicOrderId: 'ord_74cc812c-4abf-4f06-a57e-3a4c1ad6ce27',
          purchaseReference: 'T'.repeat(43),
          referenceExpiresAt: '2026-09-25T14:00:00.000Z',
          status: 'REQUEST_CREATED',
        }),
      });
    const candidate = service();
    const { lines } = captureDiagnostics(candidate);
    await expect(candidate.start({ requestId, clientNonce: 'n'.repeat(32) })).resolves.toMatchObject({
      status: 'PURCHASE_STARTED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestId).toBe(requestId);
    expect(lines).toContain('COMMERCIAL_PURCHASE_DIAGNOSTIC stage=RENDER_PURCHASE_REQUEST_RETRY_SCHEDULED attempt=1 maxAttempts=2 nextAttempt=2 delayMs=750 errorClass=HTTP_EXCEPTION errorCode=HTTP_503');
  });

  it('records Render HTTP status/duration without response-body leakage', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ secret: 'response-body-secret' }),
    });
    const candidate = service();
    const { lines } = captureDiagnostics(candidate);
    await expect(candidate.start({ requestId: '5c97ec6e-77af-4fbe-8928-6ba4931eb213', clientNonce: 'n'.repeat(32) })).rejects.toThrow(/could not complete/i);
    expect(lines.some((line) => /^COMMERCIAL_PURCHASE_DIAGNOSTIC stage=RENDER_PURCHASE_REQUEST_RESPONSE status=422 durationMs=\d+ attempt=1 maxAttempts=2$/.test(line))).toBe(true);
    expect(lines).toContain('COMMERCIAL_PURCHASE_DIAGNOSTIC stage=RENDER_PURCHASE_REQUEST_FAILED attempt=1 maxAttempts=2 errorClass=HTTP_EXCEPTION errorCode=HTTP_422');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lines.join(' ')).not.toContain('response-body-secret');
  });

  it('rejects non-S4 and non-HTTPS production origins before network access', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN = 'https://attacker.example';
    await expect(service().start({ requestId: '5c97ec6e-77af-4fbe-8928-6ba4931eb213', clientNonce: 'n'.repeat(32) })).rejects.toThrow(/not configured/i);
    process.env.PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN = 'https://licensing.sfour.co.uk';
    process.env.PATROLSAFE_COMMERCIAL_PURCHASE_ORIGIN = 'http://www.sfour.co.uk';
    await expect(service().start({ requestId: '5c97ec6e-77af-4fbe-8928-6ba4931eb213', clientNonce: 'n'.repeat(32) })).rejects.toThrow(/safely/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts only the exact Render origin for an explicitly marked private staging candidate', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PATROLSAFE_COMMERCIAL_STAGING = 'true';
    process.env.PATROLSAFE_COMMERCIAL_STAGING_BUILD = 'true';
    process.env.PATROLSAFE_COMMERCIAL_STAGING_ORIGIN = 'https://patrolsafe-commercial-staging.onrender.com';
    process.env.PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN = 'https://patrolsafe-commercial-staging.onrender.com';
    process.env.PATROLSAFE_COMMERCIAL_PURCHASE_ORIGIN = 'https://patrolsafe-commercial-staging.onrender.com';
    const requestId = '5c97ec6e-77af-4fbe-8928-6ba4931eb213';
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ requestId, publicOrderId: 'ord_74cc812c-4abf-4f06-a57e-3a4c1ad6ce27', purchaseReference: 'S'.repeat(43), referenceExpiresAt: '2026-09-24T14:00:00.000Z', status: 'REQUEST_CREATED' }) });

    await expect(service().start({ requestId, clientNonce: 'n'.repeat(32) })).resolves.toMatchObject({
      purchaseUrl: `https://patrolsafe-commercial-staging.onrender.com/patrolsafe/buy/${'S'.repeat(43)}`,
    });
  });

  it.each([
    ['missing staging marker', { PATROLSAFE_COMMERCIAL_STAGING: undefined }],
    ['missing staging build marker', { PATROLSAFE_COMMERCIAL_STAGING_BUILD: undefined }],
    ['missing authorised staging origin', { PATROLSAFE_COMMERCIAL_STAGING_ORIGIN: undefined }],
    ['alternate Render service', { PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN: 'https://other.onrender.com' }],
    ['alternate Render purchase site', { PATROLSAFE_COMMERCIAL_PURCHASE_ORIGIN: 'https://other.onrender.com' }],
  ])('rejects the private staging origin when %s', async (_label, overrides) => {
    process.env.NODE_ENV = 'production';
    process.env.PATROLSAFE_COMMERCIAL_STAGING = 'true';
    process.env.PATROLSAFE_COMMERCIAL_STAGING_BUILD = 'true';
    process.env.PATROLSAFE_COMMERCIAL_STAGING_ORIGIN = 'https://patrolsafe-commercial-staging.onrender.com';
    process.env.PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN = 'https://patrolsafe-commercial-staging.onrender.com';
    process.env.PATROLSAFE_COMMERCIAL_PURCHASE_ORIGIN = 'https://patrolsafe-commercial-staging.onrender.com';
    Object.assign(process.env, overrides);
    for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete process.env[key];

    await expect(service().start({ requestId: '5c97ec6e-77af-4fbe-8928-6ba4931eb213', clientNonce: 'n'.repeat(32) })).rejects.toThrow(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cannot switch a production build to the staging origin through environment flags', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PATROLSAFE_COMMERCIAL_PRODUCTION_BUILD = 'true';
    process.env.PATROLSAFE_COMMERCIAL_STAGING = 'true';
    process.env.PATROLSAFE_COMMERCIAL_STAGING_BUILD = 'true';
    process.env.PATROLSAFE_COMMERCIAL_STAGING_ORIGIN = 'https://patrolsafe-commercial-staging.onrender.com';
    process.env.PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN = 'https://patrolsafe-commercial-staging.onrender.com';
    process.env.PATROLSAFE_COMMERCIAL_PURCHASE_ORIGIN = 'https://patrolsafe-commercial-staging.onrender.com';

    await expect(service().start({ requestId: '5c97ec6e-77af-4fbe-8928-6ba4931eb213', clientNonce: 'n'.repeat(32) })).rejects.toThrow(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
