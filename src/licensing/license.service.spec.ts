import { generateKeyPairSync } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { base64UrlEncode, createSignedLicenseKey, parseSignedLicenseKey } from './license-crypto.util';
import { LicenseService } from './license.service';
import type { LicensePayload } from './license.types';
import {
  clearActivatedLicense,
  getLicenseStorePath,
  getStoredLicenseRecord,
  readLicenseStoreFile,
} from './license-store.util';
import { existsSync, mkdirSync, rmSync } from 'fs';
import * as path from 'path';

describe('LicenseService', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const tempRoot = path.join(process.cwd(), 'tmp-license-tests', String(process.pid));
  const configPath = path.join(tempRoot, 'workspace-config.json');
  const originalDesktopConfigPath = process.env.DESKTOP_CONFIG_PATH;
  const originalPublicKey = process.env.LICENSE_PUBLIC_KEY;

  function createConfigService(overrides?: Record<string, unknown>): ConfigService {
    const config = {
      businessTimeZone: 'Europe/London',
      trialDays: 30,
      licenseSigningSecret: 'patrol-evidence-platform-license-secret',
      licenseClockToleranceHours: 48,
      ...overrides,
    };

    return {
      get: jest.fn((key: string) => config[key as keyof typeof config]),
    } as never;
  }

  function createPayload(overrides: Partial<LicensePayload> = {}): LicensePayload {
    return {
      version: 1,
      licenseId: 'lic-test-001',
      companyName: 'ABC Security Ltd',
      plan: 'annual',
      issuedAt: '2026-07-13',
      startsAt: '2026-07-13',
      expiresAt: '2027-07-12',
      maxDevices: 1,
      features: ['collector'],
      ...overrides,
    };
  }

  function createService(): LicenseService {
    return new LicenseService(createConfigService());
  }

  beforeAll(() => {
    mkdirSync(tempRoot, { recursive: true });
  });

  beforeEach(() => {
    process.env.LICENSE_PUBLIC_KEY = publicPem;
    delete process.env.LICENSE_PUBLIC_KEY_FILE;
    delete process.env.PATROL_DESKTOP_PACKAGED;
    delete process.env.PATROL_RESOURCES_PATH;
    delete process.env.PATROL_APP_PATH;
    process.env.DESKTOP_CONFIG_PATH = configPath;
    mkdirSync(path.dirname(configPath), { recursive: true });
    rmSync(configPath, { force: true });
    clearActivatedLicense();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-13T09:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    clearActivatedLicense();
  });

  afterAll(() => {
    process.env.DESKTOP_CONFIG_PATH = originalDesktopConfigPath;
    process.env.LICENSE_PUBLIC_KEY = originalPublicKey;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('accepts a valid signed annual licence', () => {
    const service = createService();
    const licenseKey = createSignedLicenseKey(createPayload({ plan: 'annual' }), privatePem);
    const status = service.activateLicense(licenseKey, { companyName: 'ABC Security Ltd' });

    expect(status.status).toBe('ACTIVE');
    expect(status.plan).toBe('annual');
    expect(status.displayMode).toBe('Licensed');
    expect(status.licenseId).toBe('lic-test-001');
    expect(status.collectorAllowed).toBe(true);
  });

  it('accepts trial, monthly, and annual plans', () => {
    const service = createService();
    for (const plan of ['trial', 'monthly', 'annual'] as const) {
      clearActivatedLicense();
      const licenseKey = createSignedLicenseKey(createPayload({ plan, licenseId: `lic-${plan}` }), privatePem);
      const status = service.activateLicense(licenseKey);
      expect(status.plan).toBe(plan);
      expect(status.status).toBe('ACTIVE');
      expect(status.displayMode).toBe(plan === 'trial' ? 'Trial' : 'Licensed');
    }
  });

  it('rejects a modified payload', () => {
    const service = createService();
    const licenseKey = createSignedLicenseKey(createPayload(), privatePem);
    const parsed = parseSignedLicenseKey(licenseKey);
    expect(parsed).not.toBeNull();
    const payload = JSON.parse(parsed!.payloadBytes.toString('utf8')) as LicensePayload;
    payload.companyName = 'Evil Security Ltd';
    const tamperedPayloadSegment = base64UrlEncode(JSON.stringify(payload));
    const tampered = `TG1.${tamperedPayloadSegment}.${licenseKey.split('.')[2]}`;
    const verification = service.verifyLicenseKey(tampered);
    expect(verification.valid).toBe(false);
    expect(verification.signatureValid).toBe(false);
  });

  it('rejects a modified signature', () => {
    const service = createService();
    const licenseKey = createSignedLicenseKey(createPayload(), privatePem);
    const parts = licenseKey.split('.');
    parts[2] = Buffer.from('invalid-signature-bytes').toString('base64url');
    const verification = service.verifyLicenseKey(parts.join('.'));
    expect(verification.valid).toBe(false);
    expect(verification.signatureValid).toBe(false);
  });

  it('rejects an expired licence', () => {
    const service = createService();
    const licenseKey = createSignedLicenseKey(
      createPayload({ startsAt: '2026-01-01', expiresAt: '2026-01-31' }),
      privatePem,
    );
    const verification = service.verifyLicenseKey(licenseKey);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toBe('Licence has expired.');
  });

  it('rejects a future licence outside tolerance', () => {
    const service = createService();
    const licenseKey = createSignedLicenseKey(
      createPayload({ startsAt: '2026-08-01', expiresAt: '2027-08-01' }),
      privatePem,
    );
    const verification = service.verifyLicenseKey(licenseKey);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toBe('Licence is not yet valid.');
  });

  it('rejects malformed licence keys', () => {
    const service = createService();
    const verification = service.verifyLicenseKey('not-a-licence');
    expect(verification.valid).toBe(false);
  });

  it('fails safely when the public key is missing for TG1 keys', () => {
    delete process.env.LICENSE_PUBLIC_KEY;
    process.env.PATROL_DESKTOP_PACKAGED = 'true';
    process.env.LICENSE_PUBLIC_KEY_FILE = path.join(tempRoot, 'missing-license-public.pem');
    const service = createService();
    const licenseKey = createSignedLicenseKey(createPayload(), privatePem);
    const verification = service.verifyLicenseKey(licenseKey);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toContain('public key');
    process.env.LICENSE_PUBLIC_KEY = publicPem;
    delete process.env.PATROL_DESKTOP_PACKAGED;
    delete process.env.LICENSE_PUBLIC_KEY_FILE;
  });

  it('persists licence state across restarts', () => {
    const service = createService();
    const licenseKey = createSignedLicenseKey(createPayload(), privatePem);
    service.activateLicense(licenseKey);

    const reloaded = new LicenseService(createConfigService());
    const status = reloaded.getStatus();
    expect(status.status).toBe('ACTIVE');
    expect(status.licenseId).toBe('lic-test-001');
    expect(getStoredLicenseRecord()?.licenseKey).toBe(licenseKey);
  });

  it('deactivates without deleting the store installation ID', () => {
    const service = createService();
    const licenseKey = createSignedLicenseKey(createPayload(), privatePem);
    service.activateLicense(licenseKey);
    const installationId = readLicenseStoreFile()?.installationId;

    const status = service.deactivateLicense();
    expect(status.status).toBe('NOT_ACTIVATED');
    expect(getStoredLicenseRecord()).toBeNull();
    expect(readLicenseStoreFile()?.installationId).toBe(installationId);
    expect(existsSync(getLicenseStorePath()!)).toBe(true);
  });

  it('keeps legacy TG-TRIAL keys readable from workspace fallback', () => {
    const service = createService();
    const status = service.getStatus({
      companyName: 'Tech Guards Security',
      licenseKey: 'TG-TRIAL-DEV',
    });

    expect(status.legacy).toBe(true);
    expect(status.plan).toBe('trial');
    expect(status.status).toBe('ACTIVE');
  });
});
