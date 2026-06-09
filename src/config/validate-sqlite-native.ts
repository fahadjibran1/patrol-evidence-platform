import { Logger } from '@nestjs/common';

const logger = new Logger('SqliteNativeValidation');

function isNativeModuleMismatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('node_module_version') ||
    normalized.includes('was compiled against') ||
    normalized.includes('err_dlopen_failed') ||
    normalized.includes('invalid or incompatible binary')
  );
}

export function validateSqliteNativeModule(): void {
  const dbType = (process.env.DB_TYPE ?? 'sqlite').trim().toLowerCase();
  if (dbType !== 'sqlite') {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('better-sqlite3');
  } catch (error) {
    if (isNativeModuleMismatchError(error)) {
      const runtimeModules = process.versions.modules;
      const message = [
        'Native SQLite module requires rebuild.',
        `Runtime NODE_MODULE_VERSION=${runtimeModules}.`,
        'Run: npm run rebuild:native',
      ].join(' ');

      logger.error(message);
      throw new Error(message);
    }

    throw error;
  }
}
