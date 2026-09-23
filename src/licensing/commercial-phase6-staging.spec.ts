import { generateKeyPairSync } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { signCommercialLicencePayload } from '@patrol/license-core';
import { InstallationIdentityService } from './installation-identity.service';
import { LicenceEvaluationService } from './licence-evaluation.service';
import { LicenseService } from './license.service';
import { LocalTrialService } from './local-trial.service';

describe('Phase 6 staging licence import and restart', () => {
  const originalEnv = { ...process.env };
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'patrolsafe-phase6-desktop-'));
    process.env.PATROL_LICENSE_DATA_ROOT = dataRoot;
    process.env.PATROL_LICENSE_TEST_MODE = 'true';
    process.env.PATROLSAFE_COMMERCIAL_STAGING = 'true';
    process.env.DESKTOP_CONFIG_PATH = join(dataRoot, 'workspace-config.json');
    writeFileSync(process.env.DESKTOP_CONFIG_PATH, JSON.stringify({ companyName: 'Phase Six Patrols Ltd' }), 'utf8');
    const legacy = generateKeyPairSync('ed25519');
    process.env.LICENSE_PUBLIC_KEY = legacy.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    delete process.env.LICENSE_PUBLIC_KEY_FILE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(dataRoot, { recursive: true, force: true });
  });

  function services() {
    const config = { get: (key: string) => key === 'businessTimeZone' ? 'Europe/London' : key === 'trialDays' ? 30 : undefined } as ConfigService;
    const identity = new InstallationIdentityService();
    const trial = new LocalTrialService(identity);
    const evaluation = new LicenceEvaluationService(identity, trial);
    return { identity, license: new LicenseService(config, identity, trial, evaluation) };
  }

  it('imports a staging online-key .tglic immediately and remains Licensed after service restart', () => {
    const online = generateKeyPairSync('ed25519');
    process.env.LICENSE_ONLINE_PUBLIC_KEY = online.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.LICENSE_ONLINE_PUBLIC_KEY_ID = 'test-phase6-online-key';
    const first = services();
    const identity = first.identity.getOrCreateIdentity();
    const today = new Date().toISOString().slice(0, 10);
    const nextYear = new Date(`${today}T00:00:00.000Z`);
    nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);
    nextYear.setUTCDate(nextYear.getUTCDate() - 1);
    const signed = signCommercialLicencePayload({
      version: 1,
      licenceId: 'lic-phase6-staging-desktop',
      installationId: identity.installationId,
      machineFingerprint: identity.machineFingerprint,
      companyName: 'Phase Six Patrols Ltd',
      plan: 'annual',
      issuedAt: new Date().toISOString(),
      startsAt: today,
      expiresAt: nextYear.toISOString().slice(0, 10),
      features: { whatsappMonitoring: true, guardSafe: true, evidence: true, alerts: true, incidents: true, exports: true },
      product: 'Patrol Evidence Platform',
      maxDevices: 1,
    }, online.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());

    expect(first.license.importCommercialLicence(JSON.stringify(signed))).toEqual(expect.objectContaining({ uiState: 'Licensed', collectorAllowed: true }));
    expect(services().license.getStatus()).toEqual(expect.objectContaining({ uiState: 'Licensed', collectorAllowed: true }));
  });

  it('rejects the same staging licence when copied to another workstation identity', () => {
    const online = generateKeyPairSync('ed25519');
    process.env.LICENSE_ONLINE_PUBLIC_KEY = online.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.LICENSE_ONLINE_PUBLIC_KEY_ID = 'test-phase6-online-key';
    const local = services();
    const identity = local.identity.getOrCreateIdentity();
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const signed = signCommercialLicencePayload({
      version: 1,
      licenceId: 'lic-phase6-wrong-machine',
      installationId: identity.installationId,
      machineFingerprint: 'a'.repeat(64),
      companyName: 'Phase Six Patrols Ltd',
      plan: 'annual',
      issuedAt: new Date().toISOString(),
      startsAt: today,
      expiresAt: tomorrow.toISOString().slice(0, 10),
      features: { whatsappMonitoring: true, guardSafe: true, evidence: true, alerts: true, incidents: true, exports: true },
      product: 'Patrol Evidence Platform',
      maxDevices: 1,
    }, online.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());

    expect(() => local.license.importCommercialLicence(JSON.stringify(signed))).toThrow(/workstation/i);
  });
});
