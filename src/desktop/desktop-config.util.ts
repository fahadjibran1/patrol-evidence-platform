import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { dirname } from 'path';

export interface DesktopWorkspaceConfig {
  setupCompleted?: boolean;
  workspaceName?: string;
  companyName?: string;
  licenseKey?: string;
  licenseType?: 'TRIAL' | 'FULL';
  licenseStatus?: 'ACTIVE' | 'EXPIRED' | 'INVALID';
  trialStartDate?: string;
  trialEndDate?: string;
  licenseCreatedAt?: string;
  licenseUpdatedAt?: string;
  storageRootPath?: string;
  autoLaunchApp?: boolean;
  autoStartCollector?: boolean;
  whatsappHeadless?: boolean;
  whatsappAllowFromMe?: boolean;
  whatsappChromePath?: string;
  whatsappPilotGroupName?: string;
  whatsappPilotSiteCode?: string;
  linkedWhatsAppAccountId?: string;
  appTimeZone?: string;
  dbType?: 'sqlite' | 'postgres';
  sqliteDbPath?: string;
  dbHost?: string;
  dbPort?: number;
  dbUser?: string;
  dbPassword?: string;
  dbName?: string;
  localAdminEmail?: string;
  localAdminFirstName?: string;
  localAdminLastName?: string;
  lastSetupAt?: string;
}

export function normalizeSetupCompleted(value: unknown): boolean {
  if (value === true) {
    return true;
  }

  if (typeof value === 'string' && value.trim().toLowerCase() === 'true') {
    return true;
  }

  return false;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

export function loadDesktopWorkspaceConfig(configPath?: string): DesktopWorkspaceConfig {
  if (!configPath || !existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    if (!raw.trim()) {
      return {};
    }

    const parsed = JSON.parse(raw) as DesktopWorkspaceConfig;
    return {
      ...parsed,
      setupCompleted: normalizeSetupCompleted(parsed.setupCompleted),
    };
  } catch {
    return {};
  }
}

export function getDesktopConfigPath(): string | undefined {
  const value = process.env.DESKTOP_CONFIG_PATH?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function getDefaultDesktopDataDirectory(configPath = getDesktopConfigPath()): string | undefined {
  if (!configPath) {
    return undefined;
  }

  return path.join(path.dirname(configPath), 'data');
}

export function getDefaultDesktopSqlitePath(configPath = getDesktopConfigPath()): string | undefined {
  const dataDirectory = getDefaultDesktopDataDirectory(configPath);
  if (!dataDirectory) {
    return undefined;
  }

  return path.join(dataDirectory, 'patrol-evidence.db');
}

export function readDesktopWorkspaceConfig(): DesktopWorkspaceConfig {
  return loadDesktopWorkspaceConfig(getDesktopConfigPath());
}

export function getDesktopConfigValue<T extends keyof DesktopWorkspaceConfig>(
  key: T,
): DesktopWorkspaceConfig[T] | undefined {
  return readDesktopWorkspaceConfig()[key];
}

export function getDesktopBooleanConfigValue<T extends keyof DesktopWorkspaceConfig>(key: T): boolean | undefined {
  return normalizeBoolean(getDesktopConfigValue(key));
}

export function getDefaultDesktopWorkspaceConfig(): DesktopWorkspaceConfig {
  return {
    setupCompleted: false,
    autoLaunchApp: false,
    autoStartCollector: false,
    whatsappAllowFromMe: false,
    whatsappHeadless: true,
    dbType: 'sqlite',
  };
}

export function mergeDesktopWorkspaceConfig(
  current: DesktopWorkspaceConfig,
  patch: DesktopWorkspaceConfig,
): DesktopWorkspaceConfig {
  return {
    ...getDefaultDesktopWorkspaceConfig(),
    ...current,
    ...patch,
  };
}

export function getDesktopNumberConfigValue<T extends keyof DesktopWorkspaceConfig>(key: T): number | undefined {
  return normalizeNumber(getDesktopConfigValue(key));
}

export function writeDesktopWorkspaceConfigPatch(patch: DesktopWorkspaceConfig): void {
  const configPath = getDesktopConfigPath();
  if (!configPath) {
    return;
  }

  const current = loadDesktopWorkspaceConfig(configPath);
  const next = mergeDesktopWorkspaceConfig(current, patch);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
}
