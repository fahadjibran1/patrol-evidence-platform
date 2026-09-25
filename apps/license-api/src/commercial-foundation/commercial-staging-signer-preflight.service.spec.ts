import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, generateKeyPairSync } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  COMMERCIAL_STAGING_SIGNER_POLICY,
  CommercialStagingSignerPreflightService,
} from './commercial-staging-signer-preflight.service';
import {
  type CommercialSignerPreflightPolicy,
  type CommercialSignerPreflightResult,
  TestFileEd25519SigningProvider,
} from './test-file-ed25519-signing.provider';

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

function successfulResult(): CommercialSignerPreflightResult {
  return {
    keyIdValid: true,
    keyPathValid: true,
    fileReadable: true,
    keyParseValid: true,
    keyTypeValid: true,
    publicKeySha256: COMMERCIAL_STAGING_SIGNER_POLICY.publicKeySha256,
    publicKeyMatch: true,
    passed: true,
  };
}

describe('commercial staging signer preflight', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'patrolsafe-signer-preflight-'));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  async function providerFor(
    privateKeyPem: string,
    overrides: Partial<Record<'keyId' | 'keyPath', string>> = {},
  ) {
    const keyPath = join(root, 'staging-private.pem');
    await writeFile(keyPath, privateKeyPem, { encoding: 'utf8', mode: 0o600 });
    const keyId = overrides.keyId ?? 'test-authorised-key';
    const configuredPath = overrides.keyPath ?? keyPath;
    return {
      keyPath,
      provider: new TestFileEd25519SigningProvider(config({
        COMMERCIAL_TEST_SIGNING_KEY_ID: keyId,
        COMMERCIAL_TEST_SIGNING_PRIVATE_KEY_FILE: configuredPath,
      })),
    };
  }

  function policy(keyPath: string, publicKeySha256: string): CommercialSignerPreflightPolicy {
    return { keyId: 'test-authorised-key', keyPath, publicKeySha256 };
  }

  it('accepts a valid authorised Ed25519 staging key', async () => {
    const pair = generateKeyPairSync('ed25519');
    const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicDer = pair.publicKey.export({ type: 'spki', format: 'der' });
    const fingerprint = createHash('sha256').update(publicDer).digest('hex').toUpperCase();
    const { provider, keyPath } = await providerFor(privatePem);

    await expect(provider.preflight(policy(keyPath, fingerprint))).resolves.toMatchObject({
      keyIdValid: true,
      keyPathValid: true,
      fileReadable: true,
      keyParseValid: true,
      keyTypeValid: true,
      publicKeySha256: fingerprint,
      publicKeyMatch: true,
      passed: true,
    });
  });

  it('rejects the wrong key ID without reading a key', async () => {
    const pair = generateKeyPairSync('ed25519');
    const { provider, keyPath } = await providerFor(
      pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      { keyId: 'test-wrong-key' },
    );
    await expect(provider.preflight(policy(keyPath, 'A'.repeat(64)))).resolves.toMatchObject({
      keyIdValid: false,
      fileReadable: false,
      passed: false,
    });
  });

  it('rejects the wrong configured path without reading it', async () => {
    const pair = generateKeyPairSync('ed25519');
    const { provider, keyPath } = await providerFor(
      pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      { keyPath: join(root, 'wrong-private.pem') },
    );
    await expect(provider.preflight(policy(keyPath, 'A'.repeat(64)))).resolves.toMatchObject({
      keyPathValid: false,
      fileReadable: false,
      passed: false,
    });
  });

  it('rejects a missing or unreadable key file', async () => {
    const missing = join(root, 'missing.pem');
    const provider = new TestFileEd25519SigningProvider(config({
      COMMERCIAL_TEST_SIGNING_KEY_ID: 'test-authorised-key',
      COMMERCIAL_TEST_SIGNING_PRIVATE_KEY_FILE: missing,
    }));
    await expect(provider.preflight(policy(missing, 'A'.repeat(64)))).resolves.toMatchObject({
      fileReadable: false,
      keyParseValid: false,
      passed: false,
    });
  });

  it('rejects a malformed private key', async () => {
    const { provider, keyPath } = await providerFor('PRIVATE-SECRET-SENTINEL');
    await expect(provider.preflight(policy(keyPath, 'A'.repeat(64)))).resolves.toMatchObject({
      fileReadable: true,
      keyParseValid: false,
      passed: false,
    });
  });

  it('rejects a non-Ed25519 private key', async () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { provider, keyPath } = await providerFor(
      pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    await expect(provider.preflight(policy(keyPath, 'A'.repeat(64)))).resolves.toMatchObject({
      keyParseValid: true,
      keyTypeValid: false,
      passed: false,
    });
  });

  it('rejects a public-key fingerprint mismatch', async () => {
    const pair = generateKeyPairSync('ed25519');
    const { provider, keyPath } = await providerFor(
      pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    await expect(provider.preflight(policy(keyPath, 'A'.repeat(64)))).resolves.toMatchObject({
      keyTypeValid: true,
      publicKeyMatch: false,
      passed: false,
    });
  });

  it('runs only behind all staging gates and passes the exact authorised policy', async () => {
    expect(COMMERCIAL_STAGING_SIGNER_POLICY).toEqual({
      keyId: 'test-phase6-online-key',
      keyPath: '/etc/secrets/patrolsafe-staging-ed25519-private.pem',
      publicKeySha256: '688340412959FBC23E8C3F0CB17BC6CFC2EE121254ACE2256D66216B2A512582',
    });
    const signer = { preflight: jest.fn().mockResolvedValue(successfulResult()) } as unknown as TestFileEd25519SigningProvider;
    const service = new CommercialStagingSignerPreflightService(config({
      NODE_ENV: 'staging',
      PATROLSAFE_COMMERCIAL_STAGING: 'true',
      COMMERCIAL_TEST_ISSUER_ENABLED: 'true',
    }), signer);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await service.verify();

    expect(signer.preflight).toHaveBeenCalledWith(COMMERCIAL_STAGING_SIGNER_POLICY);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('result=PASS'));
  });

  it.each([
    { NODE_ENV: 'development', PATROLSAFE_COMMERCIAL_STAGING: 'true', COMMERCIAL_TEST_ISSUER_ENABLED: 'true' },
    { NODE_ENV: 'staging', PATROLSAFE_COMMERCIAL_STAGING: 'false', COMMERCIAL_TEST_ISSUER_ENABLED: 'true' },
    { NODE_ENV: 'staging', PATROLSAFE_COMMERCIAL_STAGING: 'true', COMMERCIAL_TEST_ISSUER_ENABLED: 'false' },
    { NODE_ENV: 'production', PATROLSAFE_COMMERCIAL_STAGING: 'true', COMMERCIAL_TEST_ISSUER_ENABLED: 'true' },
  ])('does not run outside the complete staging gate: %o', async (values) => {
    const signer = { preflight: jest.fn() } as unknown as TestFileEd25519SigningProvider;
    await new CommercialStagingSignerPreflightService(config(values), signer).verify();
    expect(signer.preflight).not.toHaveBeenCalled();
  });

  it('fails startup closed and logs no supplied secret material', async () => {
    const secret = 'PRIVATE-SECRET-SENTINEL';
    const signer = {
      preflight: jest.fn().mockResolvedValue({
        ...successfulResult(),
        keyParseValid: false,
        publicKeySha256: 'UNAVAILABLE',
        publicKeyMatch: false,
        passed: false,
        secret,
      }),
    } as unknown as TestFileEd25519SigningProvider;
    const service = new CommercialStagingSignerPreflightService(config({
      NODE_ENV: 'staging',
      PATROLSAFE_COMMERCIAL_STAGING: 'true',
      COMMERCIAL_TEST_ISSUER_ENABLED: 'true',
      LICENSE_DATABASE_URL: 'DATABASE-SECRET-SENTINEL',
      COMMERCIAL_STRIPE_SECRET_KEY: 'STRIPE-SECRET-SENTINEL',
      COMMERCIAL_RESEND_API_KEY: 'RESEND-SECRET-SENTINEL',
      COMMERCIAL_DELIVERY_TOKEN_SECRET: 'DELIVERY-SECRET-SENTINEL',
    }), signer);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(service.verify()).rejects.toThrow('COMMERCIAL_SIGNER_PREFLIGHT_FAILED');

    const output = JSON.stringify(error.mock.calls);
    expect(output).toContain('result=FAIL');
    expect(output).not.toContain(secret);
    expect(output).not.toContain('DATABASE-SECRET-SENTINEL');
    expect(output).not.toContain('STRIPE-SECRET-SENTINEL');
    expect(output).not.toContain('RESEND-SECRET-SENTINEL');
    expect(output).not.toContain('DELIVERY-SECRET-SENTINEL');
  });
});
