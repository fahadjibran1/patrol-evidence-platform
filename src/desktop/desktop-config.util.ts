import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync, readFileSync } from 'fs';
import * as path from 'path';
import { dirname } from 'path';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  assertIanaTimeZone,
  normalizeIanaTimeZone,
} from '@/common/utils/patrol-time.util';

export interface DesktopWorkspaceConfig {
  setupCompleted?: boolean;
  setupStage?: DesktopSetupStage;
  workspaceName?: string;
  companyName?: string;
  licenseKey?: string;
  licenseType?: 'TRIAL' | 'FULL' | 'MONTHLY' | 'ANNUAL';
  licenseStatus?: 'ACTIVE' | 'EXPIRED' | 'INVALID' | 'NOT_ACTIVATED';
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
  /** Preferred automation browser: chrome | edge | auto */
  whatsappBrowser?: 'chrome' | 'edge' | 'auto';
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

export type DesktopSetupStage = 'company' | 'storage' | 'whatsapp' | 'site-setup' | 'complete';

const DESKTOP_SETUP_STAGES = new Set<DesktopSetupStage>([
  'company',
  'storage',
  'whatsapp',
  'site-setup',
  'complete',
]);

export function normalizeDesktopSetupStage(value: unknown): DesktopSetupStage {
  return typeof value === 'string' && DESKTOP_SETUP_STAGES.has(value as DesktopSetupStage)
    ? (value as DesktopSetupStage)
    : 'company';
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
    const setupCompleted = normalizeSetupCompleted(parsed.setupCompleted);
    const appTimeZone = parsed.appTimeZone === undefined
      ? undefined
      : normalizeIanaTimeZone(parsed.appTimeZone) ?? String(parsed.appTimeZone);
    return {
      ...parsed,
      appTimeZone,
      setupCompleted,
      setupStage: setupCompleted ? 'complete' : normalizeDesktopSetupStage(parsed.setupStage),
    };
  } catch {
    return {};
  }
}

export function resolveWorkspaceTimeZone(config: DesktopWorkspaceConfig): string {
  if (config.appTimeZone !== undefined) {
    return assertIanaTimeZone(config.appTimeZone);
  }

  // v1 installations created before explicit timezone support operated as
  // Europe/London. Preserve that meaning instead of reinterpreting history.
  if (normalizeSetupCompleted(config.setupCompleted)) {
    return DEFAULT_BUSINESS_TIMEZONE;
  }

  throw new Error('Choose a valid time zone from the list.');
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
    setupStage: 'company',
    autoLaunchApp: false,
    autoStartCollector: false,
    whatsappAllowFromMe: false,
    whatsappHeadless: true,
    whatsappBrowser: 'auto',
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
  writeDesktopWorkspaceConfigFile(configPath, next);
}

export function writeDesktopWorkspaceConfigFile(configPath: string, config: DesktopWorkspaceConfig): void {
  const directory = dirname(configPath);
  const temporaryPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(temporaryPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, configPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}
