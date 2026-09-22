import { generateKeyPairSync } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { signCommercialLicencePayload } from '@patrol/license-core';

const { validateBackedUpCommercialLicence } = require('../../desktop/commercial-licence-backup') as {
  validateBackedUpCommercialLicence(input: {
    licencePath: string;
    identityPath: string;
    legacyPublicKeyPath: string;
    onlinePublicKeyPath?: string;
  }): boolean;
};

describe('commercial licence backup restore validation', () => {
  const keys = generateKeyPairSync('ed25519');
  const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  let root: string;

  beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'commercial-licence-backup-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function fixture(machineFingerprint = 'a'.repeat(64)) {
    const identityPath = path.join(root, 'installation-identity.json');
    const licencePath = path.join(root, 'commercial-licence.tglic');
    const legacyPublicKeyPath = path.join(root, 'license-public.pem');
    writeFileSync(identityPath, JSON.stringify({ installationId: 'installation-1', machineFingerprint }));
    writeFileSync(legacyPublicKeyPath, publicPem);
    const licence = signCommercialLicencePayload({
      version: 1,
      licenceId: 'lic-backup-test',
      installationId: 'installation-1',
      machineFingerprint: 'a'.repeat(64),
      companyName: 'Backup Test Ltd',
      plan: 'annual',
      issuedAt: '2026-09-22',
      startsAt: '2026-09-22',
      expiresAt: '2027-09-21',
      features: { whatsappMonitoring: true, guardSafe: true, evidence: true, alerts: true, incidents: true, exports: true },
      product: 'Patrol Evidence Platform',
      maxDevices: 1,
    }, privatePem);
    writeFileSync(licencePath, JSON.stringify(licence));
    return { identityPath, licencePath, legacyPublicKeyPath };
  }

  it('accepts a signed licence bound to the backed same-machine identity', () => {
    expect(validateBackedUpCommercialLicence(fixture())).toBe(true);
  });

  it('rejects replacement-machine identity and corrupt licence material', () => {
    expect(() => validateBackedUpCommercialLicence(fixture('b'.repeat(64)))).toThrow(/does not validate/);
    const corrupt = fixture();
    writeFileSync(corrupt.licencePath, '{"payload":{},"signature":"bad"}');
    expect(() => validateBackedUpCommercialLicence(corrupt)).toThrow();
  });
});
