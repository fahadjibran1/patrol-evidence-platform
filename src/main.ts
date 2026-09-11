import { appendFileSync, mkdirSync } from 'fs';
import * as path from 'path';
import { json, urlencoded } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { validateSqliteNativeModule } from './config/validate-sqlite-native';
import { resolveBackendListenConfig } from './config/backend-listen.config';
import { createPatrolSafeCorsOriginValidator, DESKTOP_API_TOKEN_HEADER } from './config/cors-origin.util';
import { resolveDatabaseType, resolveSqliteDatabasePath } from './config/database-settings.util';

/** Binary patrol images up to 25MB need ~34MB+ as base64 inside JSON. */
const PATROL_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_UPLOAD_BODY_LIMIT_MB = 40;

function resolveUploadBodyLimit(): { limitMb: number; limit: string } {
  const configuredMb = Number(process.env.PATROL_UPLOAD_BODY_LIMIT_MB ?? DEFAULT_UPLOAD_BODY_LIMIT_MB);
  const limitMb =
    Number.isFinite(configuredMb) && configuredMb > 0
      ? Math.max(configuredMb, Math.ceil(PATROL_IMAGE_MAX_BYTES / (1024 * 1024)))
      : DEFAULT_UPLOAD_BODY_LIMIT_MB;

  return {
    limitMb,
    limit: `${limitMb}mb`,
  };
}

function getBackendLogPath(): string | null {
  const configPath = process.env.DESKTOP_CONFIG_PATH?.trim();
  if (!configPath) {
    return null;
  }

  return path.join(path.dirname(configPath), 'backend-runtime.log');
}

function writeBackendRuntimeLog(message: string, details?: string): void {
  const backendLogPath = getBackendLogPath();
  if (!backendLogPath) {
    return;
  }

  const line = `[${new Date().toISOString()}] ${message}${details ? ` ${details}` : ''}`;

  try {
    mkdirSync(path.dirname(backendLogPath), { recursive: true });
    appendFileSync(backendLogPath, `${line}\n`, 'utf8');
  } catch {
    // Ignore backend log write errors to avoid masking the original startup issue.
  }
}

process.on('uncaughtException', (error) => {
  writeBackendRuntimeLog('uncaughtException', error instanceof Error ? error.stack || error.message : String(error));
});

process.on('unhandledRejection', (reason) => {
  writeBackendRuntimeLog('unhandledRejection', reason instanceof Error ? reason.stack || reason.message : String(reason));
});

async function bootstrap(): Promise<void> {
  validateSqliteNativeModule();
  if (resolveDatabaseType() === 'sqlite') {
    // Keep direct backend launches fail-closed too. Packaged Electron performs
    // the same idempotent preparation before spawning this process.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prepareSqliteDatabase } = require(path.resolve(__dirname, '..', 'desktop', 'data-durability.js')) as {
      prepareSqliteDatabase: (options: Record<string, unknown>) => {
        schemaVersion: number;
        applied: string[];
      };
    };
    const sqlitePath = resolveSqliteDatabasePath();
    const migration = prepareSqliteDatabase({
      databasePath: sqlitePath,
      preUpgradeBackupRoot: path.join(path.dirname(sqlitePath), 'pre-upgrade-backups'),
      appVersion: process.env.PATROLSAFE_APP_VERSION ?? 'development',
      buildId: process.env.PATROLSAFE_BUILD_ID ?? 'development',
    });
    writeBackendRuntimeLog(
      'sqlite-schema-ready',
      `version=${migration.schemaVersion} applied=${migration.applied.join(',') || 'none'}`,
    );
  }
  writeBackendRuntimeLog(
    'bootstrap:start',
    `port=${process.env.PORT ?? 3000} cwd=${process.cwd()} dbType=${process.env.DB_TYPE ?? 'unset'} desktopConfig=${
      process.env.DESKTOP_CONFIG_PATH ?? 'unset'
    } storage=${process.env.STORAGE_ROOT_PATH ?? 'unset'}`,
  );
  const uploadBodyLimit = resolveUploadBodyLimit();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  writeBackendRuntimeLog('bootstrap:nest-created');

  app.use(json({ limit: uploadBodyLimit.limit }));
  app.use(urlencoded({ limit: uploadBodyLimit.limit, extended: true }));
  writeBackendRuntimeLog(
    'upload-body-limit-configured',
    `json=${uploadBodyLimit.limit} urlencoded=${uploadBodyLimit.limit} maxImageMb=${PATROL_IMAGE_MAX_BYTES / (1024 * 1024)}`,
  );

  app.enableCors({
    origin: createPatrolSafeCorsOriginValidator({
      desktopMode: Boolean(process.env.DESKTOP_CONFIG_PATH?.trim()),
      developmentMode: process.env.NODE_ENV === 'development' || process.env.DESKTOP_DEV === 'true',
      configuredDevelopmentOrigins: process.env.PATROLSAFE_DESKTOP_DEV_ORIGINS,
    }),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      DESKTOP_API_TOKEN_HEADER,
      'x-patrol-collector-token',
      'x-patrolsafe-recovery-authority',
      'x-patrolsafe-recovery-token',
    ],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableShutdownHooks();
  writeBackendRuntimeLog('bootstrap:pipes-ready');

  const listen = resolveBackendListenConfig();
  if (listen.host) {
    await app.listen(listen.port, listen.host);
  } else {
    await app.listen(listen.port);
  }
  writeBackendRuntimeLog('bootstrap:listening', `host=${listen.host ?? 'default'} port=${listen.port}`);
}

void bootstrap();
