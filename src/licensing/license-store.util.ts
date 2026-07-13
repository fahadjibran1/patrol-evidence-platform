import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { getDesktopConfigPath } from '@/desktop/desktop-config.util';
import type { LicenseStoreFile, StoredLicenseRecord } from './license.types';

const LICENSE_STORE_FILE_NAME = 'license-store.json';

export function getLicenseStorePath(): string | null {
  const configPath = getDesktopConfigPath();
  if (!configPath) {
    return null;
  }

  return path.join(path.dirname(configPath), LICENSE_STORE_FILE_NAME);
}

export function readLicenseStoreFile(): LicenseStoreFile | null {
  const storePath = getLicenseStorePath();
  if (!storePath || !existsSync(storePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as LicenseStoreFile;
    if (!parsed.installationId?.trim()) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeLicenseStoreFile(store: LicenseStoreFile): void {
  const storePath = getLicenseStorePath();
  if (!storePath) {
    return;
  }

  mkdirSync(path.dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
}

export function ensureInstallationId(): string {
  const existing = readLicenseStoreFile();
  if (existing?.installationId?.trim()) {
    return existing.installationId.trim();
  }

  const installationId = randomUUID();
  writeLicenseStoreFile({
    installationId,
    license: existing?.license ?? null,
  });
  return installationId;
}

export function saveActivatedLicense(record: StoredLicenseRecord): void {
  const installationId = ensureInstallationId();
  writeLicenseStoreFile({
    installationId,
    license: record,
  });
}

export function clearActivatedLicense(): void {
  const installationId = ensureInstallationId();
  writeLicenseStoreFile({
    installationId,
    license: null,
  });
}

export function getStoredLicenseRecord(): StoredLicenseRecord | null {
  return readLicenseStoreFile()?.license ?? null;
}
