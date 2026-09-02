import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import type { SignedCommercialLicence } from '@patrol/license-core';
import { getDesktopConfigPath } from '@/desktop/desktop-config.util';

const COMMERCIAL_LICENCE_FILE = 'commercial-licence.tglic';

export function getCommercialLicencePath(): string | null {
  const configPath = getDesktopConfigPath();
  if (configPath) {
    return path.join(path.dirname(configPath), COMMERCIAL_LICENCE_FILE);
  }

  if (process.env.PATROL_LICENSE_DATA_ROOT?.trim()) {
    return path.join(process.env.PATROL_LICENSE_DATA_ROOT.trim(), COMMERCIAL_LICENCE_FILE);
  }

  return null;
}

export function getStoredCommercialLicence(): SignedCommercialLicence | null {
  const filePath = getCommercialLicencePath();
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as SignedCommercialLicence;
  } catch {
    return null;
  }
}

export function saveCommercialLicence(licence: SignedCommercialLicence): void {
  const filePath = getCommercialLicencePath();
  if (!filePath) {
    throw new Error('Desktop licence data path is not configured.');
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(licence, null, 2)}\n`, 'utf8');
}

export function clearCommercialLicence(): void {
  const filePath = getCommercialLicencePath();
  if (!filePath || !existsSync(filePath)) {
    return;
  }

  const { unlinkSync } = require('fs') as typeof import('fs');
  unlinkSync(filePath);
}
