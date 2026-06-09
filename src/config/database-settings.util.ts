import * as path from 'path';
import {
  getDefaultDesktopSqlitePath,
  getDesktopConfigValue,
} from '@/desktop/desktop-config.util';

export type SupportedDatabaseType = 'sqlite' | 'postgres';

export function isDesktopRuntime(): boolean {
  return Boolean(process.env.DESKTOP_CONFIG_PATH?.trim());
}

export function resolveDatabaseType(): SupportedDatabaseType {
  const configuredType = getDesktopConfigValue('dbType') ?? process.env.DB_TYPE;
  const normalizedType = String(configuredType ?? '').trim().toLowerCase();

  if (normalizedType === 'postgres') {
    return 'postgres';
  }

  if (normalizedType === 'sqlite' || (isDesktopRuntime() && !normalizedType)) {
    return 'sqlite';
  }

  return 'postgres';
}

export function resolveSqliteDatabasePath(): string {
  const configuredPath = getDesktopConfigValue('sqliteDbPath') ?? process.env.SQLITE_DB_PATH;
  const normalizedPath = String(configuredPath ?? '').trim();

  if (normalizedPath) {
    return normalizedPath;
  }

  return getDefaultDesktopSqlitePath() ?? path.join(process.cwd(), 'data', 'patrol-evidence.db');
}
