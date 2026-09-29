import { generateKeyPairSync } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const productionKey = require('../../scripts/lib/commercial-production-public-key') as {
  COMMERCIAL_PRODUCTION_KEY_ID: string;
  COMMERCIAL_PRODUCTION_PUBLIC_KEY_SHA256: string;
  COMMERCIAL_STAGING_PUBLIC_KEY_SHA256: string;
  getTrackedProductionPublicKeyPath: (root: string) => string;
  assertAuthorisedProductionFingerprint: (derived: string, authorised?: string) => void;
  validateAuthorisedProductionPublicKeyFile: (filePath: string) => {
    fingerprint: string;
    contents: string;
  };
};

describe('authorised commercial production public key package input', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'patrolsafe-production-public-key-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('loads the tracked public-only Ed25519 key with the exact authorised identity', () => {
    const tracked = productionKey.getTrackedProductionPublicKeyPath(
      path.resolve(__dirname, '..', '..'),
    );
    const result = productionKey.validateAuthorisedProductionPublicKeyFile(tracked);
    expect(productionKey.COMMERCIAL_PRODUCTION_KEY_ID).toBe('vesoft-online-v1');
    expect(result.fingerprint).toBe(
      'CEAA988A6B2AD61DA4323450B51FA56A18AF804881601DCF3F5FF03E78485F30',
    );
    expect(result.contents).toContain('BEGIN PUBLIC KEY');
    expect(result.contents).not.toMatch(/PRIVATE KEY/i);
  });

  it('rejects a different Ed25519 public key', () => {
    const pair = generateKeyPairSync('ed25519');
    const filePath = path.join(root, 'wrong-public.pem');
    fs.writeFileSync(filePath, pair.publicKey.export({ type: 'spki', format: 'pem' }));
    expect(() => productionKey.validateAuthorisedProductionPublicKeyFile(filePath))
      .toThrow('COMMERCIAL_PRODUCTION_PUBLIC_KEY_FINGERPRINT_MISMATCH');
  });

  it('rejects private PEM material supplied as the public package input', () => {
    const pair = generateKeyPairSync('ed25519');
    const filePath = path.join(root, 'private.pem');
    fs.writeFileSync(filePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    expect(() => productionKey.validateAuthorisedProductionPublicKeyFile(filePath))
      .toThrow(/private key/i);
  });

  it('rejects a non-Ed25519 public key', () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const filePath = path.join(root, 'rsa-public.pem');
    fs.writeFileSync(filePath, pair.publicKey.export({ type: 'spki', format: 'pem' }));
    expect(() => productionKey.validateAuthorisedProductionPublicKeyFile(filePath))
      .toThrow(/must be an Ed25519 public key/);
  });

  it('rejects the staging fingerprint as either derived or authorised identity', () => {
    expect(() => productionKey.assertAuthorisedProductionFingerprint(
      productionKey.COMMERCIAL_STAGING_PUBLIC_KEY_SHA256,
    )).toThrow('COMMERCIAL_PRODUCTION_STAGING_PUBLIC_KEY_REJECTED');
    expect(() => productionKey.assertAuthorisedProductionFingerprint(
      productionKey.COMMERCIAL_PRODUCTION_PUBLIC_KEY_SHA256,
      productionKey.COMMERCIAL_STAGING_PUBLIC_KEY_SHA256,
    )).toThrow('COMMERCIAL_PRODUCTION_STAGING_PUBLIC_KEY_REJECTED');
  });
});
