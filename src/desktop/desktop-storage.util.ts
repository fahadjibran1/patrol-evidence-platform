import { accessSync, constants, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import * as path from 'path';
import {
  DesktopWorkspaceConfig,
  getDefaultDesktopDataDirectory,
  getDesktopConfigPath,
  normalizeSetupCompleted,
  readDesktopWorkspaceConfig,
} from './desktop-config.util';

function isAutoStartCollectorEnabled(config: DesktopWorkspaceConfig): boolean {
  const value = config.autoStartCollector as unknown;
  if (value === true) {
    return true;
  }

  if (typeof value === 'string' && value.trim().toLowerCase() === 'true') {
    return true;
  }

  return false;
}

export function resolveConfiguredStorageRootPath(workspace?: DesktopWorkspaceConfig): string {
  const config = workspace ?? readDesktopWorkspaceConfig();
  const configured = config.storageRootPath?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  const fromEnv = process.env.STORAGE_ROOT_PATH?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  const dataDirectory = getDefaultDesktopDataDirectory(getDesktopConfigPath());
  if (dataDirectory) {
    return path.join(dataDirectory, 'Security_Patrols');
  }

  return path.resolve(path.join(process.cwd(), 'Security_Patrols'));
}

export function resolveDesktopWhatsAppAutoStart(workspace?: DesktopWorkspaceConfig): boolean {
  const config = workspace ?? readDesktopWorkspaceConfig();

  if (!isAutoStartCollectorEnabled(config)) {
    return false;
  }

  if (process.env.DESKTOP_CONFIG_PATH?.trim() && !normalizeSetupCompleted(config.setupCompleted)) {
    return false;
  }

  if (process.env.DESKTOP_CONFIG_PATH?.trim()) {
    return true;
  }

  return process.env.WHATSAPP_AUTO_START === 'true';
}

export function applyStorageRootPath(storageRootPath: string): string {
  const resolved = path.resolve(storageRootPath.trim());
  mkdirSync(resolved, { recursive: true });

  const probePath = path.join(resolved, '.patrol-storage-write-test');
  try {
    writeFileSync(probePath, 'ok', 'utf8');
    unlinkSync(probePath);
    accessSync(resolved, constants.R_OK | constants.W_OK);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Storage folder is not writable: ${resolved} (${message})`);
  }

  return resolved;
}

export function storagePathsMatch(expectedPath: string, actualPath: string): boolean {
  return path.resolve(expectedPath.trim()) === path.resolve(actualPath.trim());
}
