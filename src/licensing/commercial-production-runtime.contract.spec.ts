import { generateKeyPairSync } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const runtime = require('../../desktop/commercial-production-runtime') as {
  COMMERCIAL_PRODUCTION_CONFIG_FILE: string;
  COMMERCIAL_PRODUCTION_PUBLIC_KEY_FILE: string;
  COMMERCIAL_PRODUCTION_PUBLIC_KEY_SHA256: string;
  loadPackagedCommercialProductionRuntime: (root: string) => unknown;
};

describe('packaged commercial production runtime contract', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'patrolsafe-production-runtime-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function fixture(overrides: Record<string, unknown> = {}): string {
    const fingerprint = runtime.COMMERCIAL_PRODUCTION_PUBLIC_KEY_SHA256;
    fs.copyFileSync(
      path.resolve(__dirname, '..', '..', 'resources', 'license-online-public.pem'),
      path.join(root, runtime.COMMERCIAL_PRODUCTION_PUBLIC_KEY_FILE),
    );
    fs.writeFileSync(path.join(root, runtime.COMMERCIAL_PRODUCTION_CONFIG_FILE), JSON.stringify({
      schemaVersion: 1,
      production: true,
      serviceOrigin: 'https://licensing.sfour.co.uk',
      purchaseOrigin: 'https://licensing.sfour.co.uk',
      onlineKeyId: 'vesoft-online-v1',
      onlinePublicKeyFile: 'license-online-public.pem',
      onlinePublicKeySha256: fingerprint,
      ...overrides,
    }));
    return fingerprint;
  }

  it('binds the exact production origin, key ID, and public fingerprint', () => {
    const fingerprint = fixture();
    expect(runtime.loadPackagedCommercialProductionRuntime(root)).toMatchObject({
      keyId: 'vesoft-online-v1',
      publicKeyFingerprintSha256: fingerprint,
      environment: {
        PATROLSAFE_COMMERCIAL_PRODUCTION_BUILD: 'true',
        PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN: 'https://licensing.sfour.co.uk',
        LICENSE_ONLINE_PUBLIC_KEY_ID: 'vesoft-online-v1',
      },
    });
  });

  it.each([
    ['test key ID', { onlineKeyId: 'test-phase6-online-key' }],
    ['staging origin', { serviceOrigin: 'https://patrolsafe-commercial-staging.onrender.com' }],
    ['wrong fingerprint', { onlinePublicKeySha256: 'A'.repeat(64) }],
  ])('rejects %s', (_label, overrides) => {
    fixture(overrides);
    expect(() => runtime.loadPackagedCommercialProductionRuntime(root)).toThrow();
  });

  it('rejects a different Ed25519 public key even when the manifest claims the authorised fingerprint', () => {
    fixture();
    const wrong = generateKeyPairSync('ed25519');
    fs.writeFileSync(
      path.join(root, runtime.COMMERCIAL_PRODUCTION_PUBLIC_KEY_FILE),
      wrong.publicKey.export({ type: 'spki', format: 'pem' }),
    );
    expect(() => runtime.loadPackagedCommercialProductionRuntime(root)).toThrow(/fingerprint/);
  });
});
