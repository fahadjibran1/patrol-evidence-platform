import { generateKeyPairSync } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  getPublicKeyCandidatePathsForTests,
  isPackagedProductionMode,
  loadLicensePublicKey,
  loadLicensePublicKeyRing,
  readPublicKeyFile,
  resolveLicensePublicKeyFilePath,
  resolveLicensePublicKeyPem,
} from './license-public-key.util';

describe('license-public-key.util', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const tempRoot = path.join(process.cwd(), 'tmp-license-public-key-tests', String(process.pid));
  const devPublicPath = path.join(tempRoot, '.license-keys', 'license-public.pem');
  const resourcesPublicPath = path.join(tempRoot, 'resources', 'license-public.pem');
  const packagedPublicPath = path.join(tempRoot, 'packaged', 'resources', 'license-public.pem');

  const originalEnv = {
    LICENSE_PUBLIC_KEY: process.env.LICENSE_PUBLIC_KEY,
    LICENSE_PUBLIC_KEY_FILE: process.env.LICENSE_PUBLIC_KEY_FILE,
    LICENSE_ONLINE_PUBLIC_KEY: process.env.LICENSE_ONLINE_PUBLIC_KEY,
    LICENSE_ONLINE_PUBLIC_KEY_ID: process.env.LICENSE_ONLINE_PUBLIC_KEY_ID,
    PATROL_DESKTOP_PACKAGED: process.env.PATROL_DESKTOP_PACKAGED,
    PATROL_RESOURCES_PATH: process.env.PATROL_RESOURCES_PATH,
    PATROL_APP_PATH: process.env.PATROL_APP_PATH,
    DESKTOP_CONFIG_PATH: process.env.DESKTOP_CONFIG_PATH,
  };

  beforeAll(() => {
    fs.mkdirSync(path.dirname(devPublicPath), { recursive: true });
    fs.mkdirSync(path.dirname(resourcesPublicPath), { recursive: true });
    fs.mkdirSync(path.dirname(packagedPublicPath), { recursive: true });
    fs.writeFileSync(devPublicPath, publicPem, 'utf8');
    fs.writeFileSync(resourcesPublicPath, publicPem, 'utf8');
    fs.writeFileSync(packagedPublicPath, publicPem, 'utf8');
  });

  beforeEach(() => {
    delete process.env.LICENSE_PUBLIC_KEY;
    delete process.env.LICENSE_PUBLIC_KEY_FILE;
    delete process.env.LICENSE_ONLINE_PUBLIC_KEY;
    delete process.env.LICENSE_ONLINE_PUBLIC_KEY_ID;
    delete process.env.PATROL_DESKTOP_PACKAGED;
    delete process.env.PATROL_RESOURCES_PATH;
    delete process.env.PATROL_APP_PATH;
    process.env.DESKTOP_CONFIG_PATH = path.join(tempRoot, 'workspace-config.json');
  });

  afterAll(() => {
    Object.assign(process.env, originalEnv);
    fs.rmSync(path.join(process.cwd(), 'tmp-license-public-key-tests'), { recursive: true, force: true });
  });

  it('uses the development fallback path when not packaged', () => {
    const originalCwd = process.cwd();
    process.chdir(tempRoot);
    try {
      const pem = resolveLicensePublicKeyPem();
      expect(pem?.trim()).toBe(publicPem.trim());
      expect(getPublicKeyCandidatePathsForTests().some((candidate) => candidate.includes('.license-keys'))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('resolves packaged keys from LICENSE_PUBLIC_KEY_FILE', () => {
    process.env.PATROL_DESKTOP_PACKAGED = 'true';
    process.env.LICENSE_PUBLIC_KEY_FILE = packagedPublicPath;

    expect(resolveLicensePublicKeyFilePath()).toBe(packagedPublicPath);
    expect(resolveLicensePublicKeyPem()?.trim()).toBe(publicPem.trim());
    expect(loadLicensePublicKey()).not.toBeNull();
  });

  it('resolves packaged keys from PATROL_RESOURCES_PATH when file env is unset', () => {
    process.env.PATROL_DESKTOP_PACKAGED = 'true';
    process.env.PATROL_RESOURCES_PATH = path.join(tempRoot, 'packaged', 'resources');

    expect(resolveLicensePublicKeyPem()?.trim()).toBe(publicPem.trim());
  });

  it('returns null in packaged mode when the public key is missing', () => {
    process.env.PATROL_DESKTOP_PACKAGED = 'true';
    process.env.LICENSE_PUBLIC_KEY_FILE = path.join(tempRoot, 'missing', 'license-public.pem');

    expect(resolveLicensePublicKeyPem()).toBeNull();
    expect(isPackagedProductionMode()).toBe(true);
  });

  it('rejects invalid PEM content', () => {
    const invalidPath = path.join(tempRoot, 'invalid.pem');
    fs.writeFileSync(invalidPath, 'not-a-key', 'utf8');
    expect(() => readPublicKeyFile(invalidPath)).toThrow();
  });

  it('rejects private key material', () => {
    const privatePath = path.join(tempRoot, 'private.pem');
    fs.writeFileSync(privatePath, privatePem, 'utf8');
    expect(() => readPublicKeyFile(privatePath)).toThrow(/private key/i);
  });

  it('simulates backend child env receiving LICENSE_PUBLIC_KEY_FILE', () => {
    process.env.PATROL_DESKTOP_PACKAGED = 'true';
    process.env.LICENSE_PUBLIC_KEY_FILE = packagedPublicPath;

    expect(resolveLicensePublicKeyFilePath()).toBe(packagedPublicPath);
    expect(resolveLicensePublicKeyPem()?.trim()).toBe(publicPem.trim());
  });

  it('adds an explicitly configured online public key without replacing legacy trust', () => {
    process.env.LICENSE_PUBLIC_KEY = publicPem;
    const online = generateKeyPairSync('ed25519');
    process.env.LICENSE_ONLINE_PUBLIC_KEY = online.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.LICENSE_ONLINE_PUBLIC_KEY_ID = 'managed-online-v1';
    expect(loadLicensePublicKeyRing().map((entry) => [entry.keyId, entry.policy])).toEqual([
      ['vesoft-offline-v1', 'legacy-v1'],
      ['managed-online-v1', 'online-annual-v1'],
    ]);
  });

  it('detects private key material during packaging safety scans', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { findPrivateKeyViolations } = require('../../scripts/lib/license-public-key.util') as {
      findPrivateKeyViolations: (rootDir: string) => string[];
    };
    const privatePath = path.join(tempRoot, 'packaged-output', 'license-private.pem');
    fs.mkdirSync(path.dirname(privatePath), { recursive: true });
    fs.writeFileSync(privatePath, privatePem, 'utf8');

    const violations = findPrivateKeyViolations(path.join(tempRoot, 'packaged-output'));
    expect(violations.some((entry) => entry.includes('license-private'))).toBe(true);
  });
});
