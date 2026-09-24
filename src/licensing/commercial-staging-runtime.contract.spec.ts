import { generateKeyPairSync } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const runtime = require('../../desktop/commercial-staging-runtime') as {
  COMMERCIAL_STAGING_CONFIG_FILE: string;
  COMMERCIAL_STAGING_PUBLIC_KEY_FILE: string;
  COMMERCIAL_STAGING_ORIGIN: string;
  COMMERCIAL_STAGING_KEY_ID: string;
  loadPackagedCommercialStagingRuntime: (resourcesPath: string) => null | {
    keyId: string;
    publicKeyFingerprintSha256: string;
    environment: Record<string, string>;
  };
  applyPackagedCommercialStagingRuntime: (input: {
    packaged: boolean;
    resourcesPath: string;
    environment: Record<string, string>;
  }) => unknown;
};

describe('private commercial staging candidate runtime', () => {
  let root: string;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'patrolsafe-staging-runtime-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function writeValidResources(): void {
    const keys = generateKeyPairSync('ed25519');
    writeFileSync(
      join(root, runtime.COMMERCIAL_STAGING_PUBLIC_KEY_FILE),
      keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      'utf8',
    );
    writeFileSync(join(root, runtime.COMMERCIAL_STAGING_CONFIG_FILE), JSON.stringify({
      schemaVersion: 1,
      staging: true,
      serviceOrigin: runtime.COMMERCIAL_STAGING_ORIGIN,
      purchaseOrigin: runtime.COMMERCIAL_STAGING_ORIGIN,
      onlineKeyId: runtime.COMMERCIAL_STAGING_KEY_ID,
      onlinePublicKeyFile: runtime.COMMERCIAL_STAGING_PUBLIC_KEY_FILE,
    }), 'utf8');
  }

  it('binds the packaged candidate to the exact external staging origin and public key identity', () => {
    writeValidResources();
    const loaded = runtime.loadPackagedCommercialStagingRuntime(root);
    expect(loaded).not.toBeNull();
    expect(loaded?.keyId).toBe('test-phase6-online-key');
    expect(loaded?.publicKeyFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(loaded?.environment).toMatchObject({
      PATROLSAFE_COMMERCIAL_STAGING: 'true',
      PATROLSAFE_COMMERCIAL_STAGING_BUILD: 'true',
      PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN: 'https://patrolsafe-commercial-staging.onrender.com',
      PATROLSAFE_COMMERCIAL_PURCHASE_ORIGIN: 'https://patrolsafe-commercial-staging.onrender.com',
      LICENSE_ONLINE_PUBLIC_KEY_ID: 'test-phase6-online-key',
    });
  });

  it('does not apply staging configuration to an unpackaged or ordinary build', () => {
    const environment: Record<string, string> = {};
    expect(runtime.applyPackagedCommercialStagingRuntime({ packaged: false, resourcesPath: root, environment })).toBeNull();
    expect(runtime.applyPackagedCommercialStagingRuntime({ packaged: true, resourcesPath: root, environment })).toBeNull();
    expect(environment).toEqual({});
  });

  it('fails closed for alternate origins, fields, missing keys and private key material', () => {
    writeValidResources();
    const configPath = join(root, runtime.COMMERCIAL_STAGING_CONFIG_FILE);
    const base = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(configPath, JSON.stringify({ ...base, serviceOrigin: 'https://other.onrender.com' }), 'utf8');
    expect(() => runtime.loadPackagedCommercialStagingRuntime(root)).toThrow(/authorised staging identity/i);

    writeFileSync(configPath, JSON.stringify({ ...base, unexpected: true }), 'utf8');
    expect(() => runtime.loadPackagedCommercialStagingRuntime(root)).toThrow(/unexpected fields/i);

    writeFileSync(configPath, JSON.stringify(base), 'utf8');
    rmSync(join(root, runtime.COMMERCIAL_STAGING_PUBLIC_KEY_FILE));
    expect(() => runtime.loadPackagedCommercialStagingRuntime(root)).toThrow(/public key is missing/i);

    const privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    writeFileSync(join(root, runtime.COMMERCIAL_STAGING_PUBLIC_KEY_FILE), privateKey, 'utf8');
    expect(() => runtime.loadPackagedCommercialStagingRuntime(root)).toThrow(/public-only/i);
  });
});
