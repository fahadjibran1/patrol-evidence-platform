import { createPublicKey, type KeyObject } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { loadPublicKeyFromPem } from './license-crypto.util';
import type { CommercialLicenceTrustEntry } from '@patrol/license-core';

const PUBLIC_KEY_FILE_NAMES = ['license-public.pem', 'license-public.key'];
const PRIVATE_KEY_MARKERS = [/PRIVATE KEY/i, /BEGIN ED25519 PRIVATE KEY/i];

export function isPackagedProductionMode(): boolean {
  return process.env.PATROL_DESKTOP_PACKAGED === 'true' || Boolean(process.env.LICENSE_PUBLIC_KEY_FILE?.trim());
}

export function assertNotPrivateKeyMaterial(contents: string, label = 'key file'): void {
  for (const pattern of PRIVATE_KEY_MARKERS) {
    if (pattern.test(contents)) {
      throw new Error(`${label} appears to contain private key material.`);
    }
  }
}

export function readPublicKeyFile(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const contents = readFileSync(filePath, 'utf8').trim();
  if (!contents) {
    return null;
  }

  assertNotPrivateKeyMaterial(contents, filePath);
  validatePublicKeyPemContents(contents, filePath);
  return contents;
}

function validatePublicKeyPemContents(contents: string, label: string): void {
  let keyObject;
  try {
    keyObject = createPublicKey(contents);
  } catch (error) {
    throw new Error(`${label} is not valid PEM: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (keyObject.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${label} must be an Ed25519 public key.`);
  }
}

export function resolveLicensePublicKeyFilePath(): string | null {
  const explicitFile = process.env.LICENSE_PUBLIC_KEY_FILE?.trim();
  if (explicitFile) {
    return explicitFile;
  }

  if (isPackagedProductionMode()) {
    return resolvePackagedResourcePublicKeyPath();
  }

  return null;
}

export function resolveLicensePublicKeyPem(): string | null {
  const envValue = process.env.LICENSE_PUBLIC_KEY?.trim();
  if (envValue) {
    const normalized = envValue.includes('\\n') ? envValue.replace(/\\n/g, '\n') : envValue;
    assertNotPrivateKeyMaterial(normalized, 'LICENSE_PUBLIC_KEY');
    return normalized;
  }

  const explicitFile = resolveLicensePublicKeyFilePath();
  if (explicitFile) {
    return readPublicKeyFile(explicitFile);
  }

  for (const candidate of getDevelopmentPublicKeyCandidatePaths()) {
    const contents = readPublicKeyFile(candidate);
    if (contents) {
      return contents;
    }
  }

  return null;
}

function resolvePackagedResourcePublicKeyPath(): string | null {
  const resourcesPath = process.env.PATROL_RESOURCES_PATH?.trim();
  const appPath = process.env.PATROL_APP_PATH?.trim();

  const roots: string[] = [];
  if (resourcesPath) {
    roots.push(resourcesPath);
  }
  if (appPath) {
    roots.push(path.join(appPath, 'resources'));
  }

  for (const root of roots) {
    for (const fileName of PUBLIC_KEY_FILE_NAMES) {
      const candidates = [
        path.join(root, fileName),
        path.join(root, 'resources', fileName),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

function getDevelopmentPublicKeyCandidatePaths(): string[] {
  if (isPackagedProductionMode()) {
    return [];
  }

  const candidates: string[] = [];
  const cwd = process.cwd();

  for (const fileName of PUBLIC_KEY_FILE_NAMES) {
    candidates.push(path.join(cwd, 'resources', fileName));
    candidates.push(path.join(cwd, '.license-keys', fileName));
    candidates.push(path.join(__dirname, '..', '..', 'resources', fileName));
    candidates.push(path.join(__dirname, '..', 'resources', fileName));
  }

  return candidates;
}

export function loadLicensePublicKey(): KeyObject | null {
  const pem = resolveLicensePublicKeyPem();
  if (!pem) {
    return null;
  }

  try {
    const key = loadPublicKeyFromPem(pem);
    if (createPublicKey(pem).asymmetricKeyType !== 'ed25519') {
      return null;
    }
    return key;
  } catch {
    return null;
  }
}

function resolveOnlineLicensePublicKeyPem(): string | null {
  const envValue = process.env.LICENSE_ONLINE_PUBLIC_KEY?.trim();
  if (envValue) {
    const normalized = envValue.includes('\\n') ? envValue.replace(/\\n/g, '\n') : envValue;
    assertNotPrivateKeyMaterial(normalized, 'LICENSE_ONLINE_PUBLIC_KEY');
    validatePublicKeyPemContents(normalized, 'LICENSE_ONLINE_PUBLIC_KEY');
    return normalized;
  }

  const explicitFile = process.env.LICENSE_ONLINE_PUBLIC_KEY_FILE?.trim();
  if (!explicitFile) return null;
  return readPublicKeyFile(explicitFile);
}

export function loadLicensePublicKeyRing(): CommercialLicenceTrustEntry[] {
  const entries: CommercialLicenceTrustEntry[] = [];
  const legacy = loadLicensePublicKey();
  if (legacy) {
    entries.push({ keyId: 'vesoft-offline-v1', publicKey: legacy, policy: 'legacy-v1' });
  }
  const onlinePem = resolveOnlineLicensePublicKeyPem();
  if (onlinePem) {
    entries.push({
      keyId: process.env.LICENSE_ONLINE_PUBLIC_KEY_ID?.trim() || 'vesoft-online-v1',
      publicKey: loadPublicKeyFromPem(onlinePem),
      policy: 'online-annual-v1',
    });
  }
  return entries;
}

export function isLicensePublicKeyConfigured(): boolean {
  return resolveLicensePublicKeyPem() !== null;
}

/** @internal Exported for tests to inspect candidate ordering. */
export function getPublicKeyCandidatePathsForTests(): string[] {
  const explicit = resolveLicensePublicKeyFilePath();
  if (explicit) {
    return [explicit];
  }

  return getDevelopmentPublicKeyCandidatePaths();
}
