import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { generateKeyPairSync } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import {
  signCommercialLicencePayload,
  type CommercialLicencePayload,
} from '@patrol/license-core';
import { InstallationIdentityService } from './installation-identity.service';
import { LicenceEvaluationService } from './licence-evaluation.service';
import { LicenseService } from './license.service';
import { LocalTrialService } from './local-trial.service';
import { saveCommercialLicence } from './commercial-licence-store.util';

describe('commercial offline licensing', () => {
  const previousEnv = { ...process.env };
  let tempRoot: string;
  let privatePem: string;
  let publicPem: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'patrol-lic-'));
    process.env.PATROL_LICENSE_DATA_ROOT = tempRoot;
    process.env.PATROL_LICENSE_TEST_MODE = 'true';
    process.env.DESKTOP_CONFIG_PATH = path.join(tempRoot, 'workspace-config.json');
    writeFileSync(process.env.DESKTOP_CONFIG_PATH, JSON.stringify({ companyName: 'Test Co' }), 'utf8');

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.LICENSE_PUBLIC_KEY = publicPem;
    delete process.env.LICENSE_PUBLIC_KEY_FILE;
  });

  afterEach(() => {
    process.env = { ...previousEnv };
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function createServices() {
    const config = {
      get: (key: string) => {
        if (key === 'businessTimeZone') return 'Europe/London';
        if (key === 'trialDays') return 30;
        return undefined;
      },
    } as ConfigService;

    const identity = new InstallationIdentityService();
    const trial = new LocalTrialService(identity);
    const evaluation = new LicenceEvaluationService(identity, trial);
    const license = new LicenseService(config, identity, trial, evaluation);
    return { identity, trial, evaluation, license };
  }

  function payloadFor(identity: { installationId: string; machineFingerprint: string }, overrides: Partial<CommercialLicencePayload> = {}) {
    return {
      version: 1,
      licenceId: 'lic-1',
      installationId: identity.installationId,
      machineFingerprint: identity.machineFingerprint,
      companyName: 'Test Co',
      plan: 'annual' as const,
      issuedAt: '2026-07-01',
      startsAt: '2026-07-01',
      expiresAt: '2027-07-01',
      features: {
        whatsappMonitoring: true,
        guardSafe: true,
        evidence: true,
        alerts: true,
        incidents: true,
        exports: true,
      },
      product: 'Patrol Evidence Platform',
      maxDevices: 1,
      ...overrides,
    };
  }

  it('fresh install gets exactly 30 days trial', () => {
    const { license } = createServices();
    const status = license.getStatus();
    expect(status.status).toBe('TRIAL_ACTIVE');
    expect(status.uiState).toBe('Trial Active');
    expect(status.daysRemaining).toBe(30);
    expect(status.collectorAllowed).toBe(true);
  });

  it('reinstall does not reset trial when marker exists', () => {
    const first = createServices();
    const firstStatus = first.license.getStatus();
    expect(firstStatus.uiState).toBe('Trial Active');

    const trialPath = first.trial.getTrialFilePath()!;
    rmSync(trialPath, { force: true });

    const second = createServices();
    const status = second.license.getStatus();
    expect(status.uiState).not.toBe('Trial Active');
    expect(status.requiresActivation).toBe(true);
  });

  it('expired trial remains expired', () => {
    const { trial, license } = createServices();
    license.getStatus();
    const record = trial.readTrialRecord()!;
    record.expiresAt = '2020-01-01T00:00:00.000Z';
    trial['persistTrialRecord'](record);

    const status = license.getStatus();
    expect(status.status).toBe('EXPIRED');
    expect(status.collectorAllowed).toBe(false);
  });

  it('clock rollback is rejected', () => {
    const { trial, license } = createServices();
    license.getStatus();
    const record = trial.readTrialRecord()!;
    record.lastSeenAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    trial['persistTrialRecord'](record);

    const status = license.getStatus();
    expect(status.status).toBe('INVALID');
    expect(status.message).toMatch(/clock rollback/i);
  });

  it('valid commercial signature is accepted', () => {
    const { identity, license } = createServices();
    const id = identity.getOrCreateIdentity();
    const signed = signCommercialLicencePayload(payloadFor(id), privatePem);
    saveCommercialLicence(signed);

    const status = license.getStatus();
    expect(status.uiState).toBe('Licensed');
    expect(status.collectorAllowed).toBe(true);
  });

  it('modified commercial licence is rejected', () => {
    const { identity, license } = createServices();
    const id = identity.getOrCreateIdentity();
    const signed = signCommercialLicencePayload(payloadFor(id), privatePem);
    signed.payload.companyName = 'Tampered';
    saveCommercialLicence(signed);

    const status = license.getStatus();
    expect(status.status).toBe('INVALID');
  });

  it('wrong machine is rejected', () => {
    const { identity, license } = createServices();
    const id = identity.getOrCreateIdentity();
    const signed = signCommercialLicencePayload(
      payloadFor(id, { machineFingerprint: 'c'.repeat(64) }),
      privatePem,
    );
    saveCommercialLicence(signed);

    const status = license.getStatus();
    expect(status.status).toBe('INVALID');
    expect(status.message).toMatch(/workstation|installation/i);
  });

  it('lifetime licence is accepted', () => {
    const { identity, license } = createServices();
    const id = identity.getOrCreateIdentity();
    const signed = signCommercialLicencePayload(
      payloadFor(id, { plan: 'lifetime', expiresAt: null }),
      privatePem,
    );
    saveCommercialLicence(signed);

    const status = license.getStatus();
    expect(status.uiState).toBe('Licensed');
    expect(status.message).toMatch(/Lifetime/i);
  });

  it('expired commercial licence is rejected', () => {
    const { identity, license } = createServices();
    const id = identity.getOrCreateIdentity();
    const signed = signCommercialLicencePayload(
      payloadFor(id, { startsAt: '2019-01-01', expiresAt: '2020-01-01' }),
      privatePem,
    );
    saveCommercialLicence(signed);

    const status = license.getStatus();
    expect(status.status).toBe('EXPIRED');
    expect(status.collectorAllowed).toBe(false);
  });

  it('legacy trial does not regenerate a production trial', () => {
    const { trial, license } = createServices();
    mkdirSync(tempRoot, { recursive: true });
    writeFileSync(
      path.join(tempRoot, 'license-store.json'),
      JSON.stringify({
        installationId: 'legacy-inst',
        license: {
          licenseKey: 'TG-TRIAL-DEV',
          payload: {
            version: 1,
            licenseId: 'legacy-trial-tg-trial-dev',
            companyName: 'Dev',
            plan: 'trial',
            issuedAt: '2026-01-01',
            startsAt: '2026-01-01',
            expiresAt: '2026-02-01',
            maxDevices: 1,
            features: ['legacy-trial'],
          },
          activatedAt: '2026-01-01T00:00:00.000Z',
          installationId: 'legacy-inst',
          lastSuccessfulValidationAt: '2026-01-01T00:00:00.000Z',
          legacy: true,
        },
      }),
      'utf8',
    );

    const status = license.getStatus();
    expect(status.legacy).toBe(true);
    expect(status.uiState).not.toBe('Trial Active');
    expect(trial.readTrialRecord()?.consumed).toBe(true);
  });

  it('exports a request file without secrets', () => {
    const { license } = createServices();
    const result = license.createRequestFile({ companyName: 'Acme Security', requestedPlan: 'annual' });
    expect(result.fileName.endsWith('.tgreq')).toBe(true);
    expect(result.contents).toContain('installationId');
    expect(result.contents).toContain('machineFingerprint');
    expect(result.contents).not.toMatch(/PRIVATE KEY|BEGIN PRIVATE/i);
  });
});
