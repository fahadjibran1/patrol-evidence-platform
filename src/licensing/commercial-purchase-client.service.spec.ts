import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CommercialPurchaseClientService } from './commercial-purchase-client.service';
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
    await expect(service().start({ requestId: '5c97ec6e-77af-4fbe-8928-6ba4931eb213', clientNonce: 'n'.repeat(32) })).rejects.toThrow(/invalid purchase response/i);
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
});
