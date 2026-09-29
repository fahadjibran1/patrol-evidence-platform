import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, generateKeyPairSync, verify } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CommercialProductionSignerPreflightService } from './commercial-production-signer-preflight.service';
import {
  COMMERCIAL_PRODUCTION_SIGNING_KEY_ID,
  COMMERCIAL_PRODUCTION_SIGNING_PROVIDER_ID,
  COMMERCIAL_STAGING_PUBLIC_KEY_SHA256,
  ProductionFileEd25519SigningProvider,
  type ProductionSignerPreflightResult,
} from './production-file-ed25519-signing.provider';

function config(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('production Ed25519 signing provider and preflight', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'patrolsafe-production-signer-'));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  async function fixture(kind: 'ed25519' | 'rsa' = 'ed25519', overrides: Record<string, string> = {}) {
    const pair = kind === 'ed25519'
      ? generateKeyPairSync('ed25519')
      : generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const keyPath = join(root, 'production-private.pem');
    await writeFile(keyPath, privatePem, { encoding: 'utf8', mode: 0o600 });
    const fingerprint = createHash('sha256')
      .update(pair.publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex').toUpperCase();
    const values = {
      NODE_ENV: 'production',
      COMMERCIAL_MODE: 'PRODUCTION_LIVE',
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_PRODUCTION_SIGNING_PROVIDER: COMMERCIAL_PRODUCTION_SIGNING_PROVIDER_ID,
      COMMERCIAL_PRODUCTION_SIGNING_KEY_ID,
      COMMERCIAL_PRODUCTION_SIGNING_PRIVATE_KEY_FILE: keyPath,
      COMMERCIAL_PRODUCTION_SIGNING_PUBLIC_KEY_SHA256: fingerprint,
      ...overrides,
    };
    return { keyPath, fingerprint, pair, values, provider: new ProductionFileEd25519SigningProvider(config(values)) };
  }

  it('preflights, signs, and independently verifies with an authorised ephemeral production key', async () => {
    const { keyPath, fingerprint, provider } = await fixture();
    await expect(provider.preflight(keyPath)).resolves.toMatchObject({
      modeValid: true,
      providerValid: true,
      keyIdValid: true,
      keyPathValid: true,
      fingerprintConfigured: true,
      fileReadable: true,
      keyParseValid: true,
      keyTypeValid: true,
      publicKeySha256: fingerprint,
      publicKeyMatch: true,
      stagingKeyRejected: true,
      passed: true,
    });
    const payload = Buffer.from('production-commercial-licence-test');
    const signature = await provider.sign(payload);
    expect(verify(null, payload, await provider.verificationKey(), signature)).toBe(true);
  });

  it.each([
    ['wrong provider', { COMMERCIAL_PRODUCTION_SIGNING_PROVIDER: 'test-file-ed25519' }, 'providerValid'],
    ['wrong key ID', { COMMERCIAL_PRODUCTION_SIGNING_KEY_ID: 'test-phase6-online-key' }, 'keyIdValid'],
    ['staging mode', { NODE_ENV: 'staging', COMMERCIAL_MODE: 'STAGING_TEST' }, 'modeValid'],
  ])('fails closed for %s', async (_label, overrides, field) => {
    const { keyPath, provider } = await fixture('ed25519', overrides);
    const result = await provider.preflight(keyPath);
    expect(result[field as keyof ProductionSignerPreflightResult]).toBe(false);
    expect(result.fileReadable).toBe(false);
    expect(result.passed).toBe(false);
    await expect(provider.sign(Buffer.from('blocked'))).rejects.toThrow('unavailable');
  });

  it('rejects a wrong configured path and a missing file', async () => {
    const missing = join(root, 'missing.pem');
    const wrongPath = await fixture('ed25519', { COMMERCIAL_PRODUCTION_SIGNING_PRIVATE_KEY_FILE: missing });
    await expect(wrongPath.provider.preflight(wrongPath.keyPath)).resolves.toMatchObject({ keyPathValid: false, fileReadable: false, passed: false });
    const missingFile = await fixture('ed25519', { COMMERCIAL_PRODUCTION_SIGNING_PRIVATE_KEY_FILE: missing });
    await expect(missingFile.provider.preflight(missing)).resolves.toMatchObject({ keyPathValid: true, fileReadable: false, passed: false });
  });

  it('rejects malformed and non-Ed25519 private keys', async () => {
    const malformedPath = join(root, 'malformed.pem');
    await writeFile(malformedPath, 'PRIVATE-KEY-SECRET-SENTINEL', 'utf8');
    const malformed = new ProductionFileEd25519SigningProvider(config({
      NODE_ENV: 'production', COMMERCIAL_MODE: 'PRODUCTION_LIVE', COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_PRODUCTION_SIGNING_PROVIDER: COMMERCIAL_PRODUCTION_SIGNING_PROVIDER_ID,
      COMMERCIAL_PRODUCTION_SIGNING_KEY_ID,
      COMMERCIAL_PRODUCTION_SIGNING_PRIVATE_KEY_FILE: malformedPath,
      COMMERCIAL_PRODUCTION_SIGNING_PUBLIC_KEY_SHA256: 'A'.repeat(64),
    }));
    await expect(malformed.preflight(malformedPath)).resolves.toMatchObject({ fileReadable: true, keyParseValid: false, passed: false });
    const rsa = await fixture('rsa');
    await expect(rsa.provider.preflight(rsa.keyPath)).resolves.toMatchObject({ keyParseValid: true, keyTypeValid: false, passed: false });
  });

  it('rejects fingerprint mismatch, placeholder fingerprints, and the authorised staging fingerprint', async () => {
    const mismatch = await fixture('ed25519', { COMMERCIAL_PRODUCTION_SIGNING_PUBLIC_KEY_SHA256: 'A'.repeat(64) });
    await expect(mismatch.provider.preflight(mismatch.keyPath)).resolves.toMatchObject({ publicKeyMatch: false, passed: false });
    const placeholder = await fixture('ed25519', { COMMERCIAL_PRODUCTION_SIGNING_PUBLIC_KEY_SHA256: '0'.repeat(64) });
    await expect(placeholder.provider.preflight(placeholder.keyPath)).resolves.toMatchObject({ fingerprintConfigured: false, fileReadable: false, passed: false });
    const staging = await fixture('ed25519', { COMMERCIAL_PRODUCTION_SIGNING_PUBLIC_KEY_SHA256: COMMERCIAL_STAGING_PUBLIC_KEY_SHA256 });
    await expect(staging.provider.preflight(staging.keyPath)).resolves.toMatchObject({ fingerprintConfigured: false, fileReadable: false, passed: false });
  });

  it('fails production startup closed and emits only allowlisted diagnostics', async () => {
    const secret = 'PRIVATE-KEY-SECRET-SENTINEL';
    const result: ProductionSignerPreflightResult & { secret: string } = {
      modeValid: true, providerValid: true, keyIdValid: true, keyPathValid: true,
      fingerprintConfigured: true, fileReadable: true, keyParseValid: false, keyTypeValid: false,
      publicKeySha256: 'UNAVAILABLE', publicKeyMatch: false, stagingKeyRejected: true, passed: false, secret,
    };
    const signer = { preflight: jest.fn().mockResolvedValue(result) } as unknown as ProductionFileEd25519SigningProvider;
    const service = new CommercialProductionSignerPreflightService(config({
      NODE_ENV: 'production', COMMERCIAL_MODE: 'PRODUCTION_LIVE', COMMERCIAL_STRIPE_ENABLED: 'true',
      LICENSE_DATABASE_URL: 'DATABASE-SECRET-SENTINEL', COMMERCIAL_STRIPE_SECRET_KEY: 'STRIPE-SECRET-SENTINEL',
    }), signer);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    await expect(service.verify()).rejects.toThrow('COMMERCIAL_PRODUCTION_SIGNER_PREFLIGHT_FAILED');
    const output = JSON.stringify(error.mock.calls);
    expect(output).toContain('result=FAIL');
    expect(output).not.toContain(secret);
    expect(output).not.toContain('DATABASE-SECRET-SENTINEL');
    expect(output).not.toContain('STRIPE-SECRET-SENTINEL');
  });
});
