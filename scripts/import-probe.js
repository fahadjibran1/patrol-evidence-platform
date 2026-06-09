const { appendFileSync, mkdirSync } = require('fs');
const path = require('path');

const appModulePath =
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/app.module.js';

const modulesToProbe = [
  '@nestjs/common',
  '@nestjs/core',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/config/app.config.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/config/database.config.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/storage/storage.service.js',
  'whatsapp-web.js',
  'better-sqlite3',
  'sharp',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/auth/auth.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/users/users.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/health/health.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/storage/storage.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/companies/entities/company.entity.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/sites/entities/site.entity.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/auth/guards/jwt-auth.guard.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/auth/guards/roles.guard.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/sites/sites.service.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/sites/sites.controller.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/sites/sites.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/patrol-groups/patrol-groups.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/patrol-schedules/patrol-schedules.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/patrol-images/patrol-images.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/patrol-slots/patrol-slots.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/patrol-alerts/patrol-alerts.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/collectors/collectors.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/compliance/compliance.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/incidents/incidents.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/dashboard/dashboard.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/ops/ops.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/licensing/licensing.module.js',
  'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/desktop/desktop.module.js',
  appModulePath,
];

const importProbeLogPath =
  process.env.IMPORT_PROBE_LOG ||
  path.join(process.env.APPDATA || process.cwd(), 'Patrol Evidence Platform', 'import-probe.log');

mkdirSync(path.dirname(importProbeLogPath), { recursive: true });

function logLine(message) {
  appendFileSync(importProbeLogPath, `${message}\n`, 'utf8');
  console.log(message);
}

logLine('IMPORT_PROBE_START');

for (const target of modulesToProbe) {
  logLine(`IMPORT_PROBE_BEFORE ${target}`);
  try {
    require(target);
    logLine(`IMPORT_PROBE_AFTER ${target}`);
  } catch (error) {
    logLine(`IMPORT_PROBE_ERROR ${target}`);
    logLine(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  }
}

logLine('IMPORT_PROBE_DONE');

try {
  const Database = require('better-sqlite3');
  logLine(`SQLITE_STEP_BEFORE_OPEN ${process.env.SQLITE_DB_PATH || 'missing-path'}`);
  const sqliteDb = new Database(process.env.SQLITE_DB_PATH);
  logLine('SQLITE_STEP_AFTER_OPEN');
  sqliteDb.prepare('SELECT 1 AS value').get();
  logLine('SQLITE_STEP_AFTER_QUERY');
  sqliteDb.close();
  logLine('SQLITE_STEP_AFTER_CLOSE');
} catch (error) {
  logLine(`SQLITE_STEP_ERROR ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
}

async function runDataSourceProbe() {
  const { DataSource } = require('typeorm');
  const { databaseConfig } = require(
    'C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/config/database.config.js',
  );

  logLine('DATASOURCE_STEP_BEFORE_INIT');
  const dataSource = new DataSource(databaseConfig());
  await dataSource.initialize();
  logLine('DATASOURCE_STEP_AFTER_INIT');
  await dataSource.destroy();
  logLine('DATASOURCE_STEP_AFTER_DESTROY');
}

async function runBootstrapProbe() {
  const { ValidationPipe } = require('@nestjs/common');
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(appModulePath);

  logLine('BOOTSTRAP_STEP_BEFORE_CREATE');
  const app = await NestFactory.create(AppModule);
  logLine('BOOTSTRAP_STEP_AFTER_CREATE');
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableShutdownHooks();
  logLine('BOOTSTRAP_STEP_AFTER_PIPES');
  await app.listen(process.env.PORT ?? 3001);
  logLine(`BOOTSTRAP_STEP_AFTER_LISTEN ${process.env.PORT ?? 3001}`);
  await app.close();
  logLine('BOOTSTRAP_STEP_AFTER_CLOSE');
}

runDataSourceProbe()
  .then(() => runBootstrapProbe())
  .catch((error) => {
    logLine(`BOOTSTRAP_OR_DATASOURCE_ERROR ${error instanceof Error ? error.stack || error.message : String(error)}`);
    process.exit(1);
  });
