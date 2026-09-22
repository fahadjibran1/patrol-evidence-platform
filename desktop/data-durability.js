const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const BACKUP_FORMAT_VERSION = 2;
const LEGACY_BACKUP_FORMAT_VERSION = 1;
const PORTABLE_EVIDENCE_PREFIX = 'patrolsafe-backup:';
const CURRENT_SQLITE_SCHEMA_VERSION = 2;
const PRE_UPGRADE_RETENTION = 5;
const MIN_FREE_SPACE_HEADROOM = 64 * 1024 * 1024;
const MIGRATION_TABLE = 'patrol_schema_migrations';
const SAME_MACHINE_COMPONENTS = new Set([
  'data/whatsapp-session',
  'license-store.json',
  'installation-identity.json',
  'trial.dpapi',
  'trial-marker.txt',
  'commercial-licence.tglic',
]);

const BASELINE_MIGRATION_ID = 'desktop-sqlite-baseline-v1';
const DURABILITY_MIGRATION_ID = 'desktop-sqlite-durability-v2';

const BASELINE_TABLES = [
  'companies',
  'users',
  'sites',
  'patrol_groups',
  'patrol_schedules',
  'patrol_images',
  'patrol_slots',
  'patrol_alerts',
  'incidents',
  'guard_sender_mappings',
  'shift_guard_assignments',
];

const REQUIRED_CORE_COLUMNS = {
  companies: ['id', 'companyName'],
  users: ['id', 'email', 'passwordHash', 'role'],
  sites: ['id', 'companyId', 'siteCode', 'siteName'],
  patrol_groups: ['id', 'siteId', 'groupName', 'externalGroupId'],
  patrol_schedules: ['id', 'siteId', 'frequencyMinutes', 'startHour', 'endHour'],
  patrol_images: ['id', 'siteId', 'collectorType', 'storedFileName', 'filePath', 'fileSize', 'mimeType'],
};

function loadDatabaseConstructor() {
  // Loaded lazily so contract/unit tests can inspect this module even when the
  // native binding has been rebuilt for Electron rather than the host Node ABI.
  return require('better-sqlite3');
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeJsonRead(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureContained(root, candidate, label = 'Backup path') {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the managed root`);
  }
  return resolvedCandidate;
}

function normalizeRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error('Backup manifest contains an absolute or empty path');
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Backup manifest contains an unsafe relative path');
  }
  return parts.join(path.sep);
}

function getMachineBindingHash() {
  let machineGuid = '';
  if (process.platform === 'win32') {
    try {
      const output = execFileSync(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      machineGuid = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim() || '';
    } catch {
      machineGuid = '';
    }
  }
  const material = [machineGuid, os.hostname(), os.platform(), os.arch()].filter(Boolean).join('|');
  return sha256(`patrolsafe-backup-machine-v1|${material}`);
}

function openDatabase(databasePath, options = {}) {
  const Database = options.Database || loadDatabaseConstructor();
  return new Database(databasePath, options.readonly ? { readonly: true, fileMustExist: true } : undefined);
}

function integrityCheck(databasePath, options = {}) {
  let database;
  try {
    database = openDatabase(databasePath, { ...options, readonly: true });
    const rows = database.pragma('integrity_check');
    const messages = rows.map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? ''));
    if (messages.length !== 1 || messages[0].toLowerCase() !== 'ok') {
      const error = new Error('PatrolSafe database integrity check failed. Restore a verified backup before continuing.');
      error.code = 'PATROLSAFE_DATABASE_CORRUPT';
      error.details = messages;
      throw error;
    }
    return { ok: true, messages };
  } catch (error) {
    if (error?.code === 'PATROLSAFE_DATABASE_CORRUPT') throw error;
    const corruption = new Error('PatrolSafe database integrity check failed. Restore a verified backup before continuing.');
    corruption.code = 'PATROLSAFE_DATABASE_CORRUPT';
    corruption.cause = error;
    throw corruption;
  } finally {
    if (database?.open) database.close();
  }
}

function tableNames(database) {
  return new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => String(row.name)),
  );
}

function columnNames(database, tableName) {
  if (!/^[a-z_]+$/i.test(tableName)) throw new Error('Invalid schema table name');
  return new Set(database.prepare(`PRAGMA table_info("${tableName}")`).all().map((row) => String(row.name)));
}

function ensureColumn(database, tableName, columnName, declaration) {
  if (!columnNames(database, tableName).has(columnName)) {
    database.exec(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${declaration}`);
  }
}

function verifyCoreSchema(database) {
  const tables = tableNames(database);
  for (const [tableName, columns] of Object.entries(REQUIRED_CORE_COLUMNS)) {
    if (!tables.has(tableName)) throw new Error(`SQLite schema adoption blocked: required table ${tableName} is missing`);
    const present = columnNames(database, tableName);
    for (const column of columns) {
      if (!present.has(column)) {
        throw new Error(`SQLite schema adoption blocked: ${tableName}.${column} is missing`);
      }
    }
  }
}

function createBaselineSchema(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS "companies" ("id" varchar PRIMARY KEY NOT NULL, "companyName" varchar(160) NOT NULL, "active" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS "users" ("id" varchar PRIMARY KEY NOT NULL, "email" varchar(160) NOT NULL, "passwordHash" varchar(255) NOT NULL, "firstName" varchar(80) NOT NULL, "lastName" varchar(80) NOT NULL, "role" text NOT NULL, "companyId" varchar, "active" boolean NOT NULL DEFAULT (1), "approved" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_6f9395c9037632a31107c8a9e58" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE NO ACTION);
    CREATE TABLE IF NOT EXISTS "sites" ("id" varchar PRIMARY KEY NOT NULL, "companyId" varchar NOT NULL, "siteCode" varchar(20) NOT NULL, "siteName" varchar(120) NOT NULL, "clientName" varchar(120), "active" boolean NOT NULL DEFAULT (1), "archivedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_848a3c31ba20ef10f38f1be19fa" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE NO ACTION);
    CREATE TABLE IF NOT EXISTS "patrol_groups" ("id" varchar PRIMARY KEY NOT NULL, "siteId" varchar NOT NULL, "groupName" varchar(150) NOT NULL, "externalGroupId" varchar(120), "sourceType" varchar(20) NOT NULL DEFAULT ('group'), "linkedAccountId" varchar(120), "active" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_af38b2044576ee4be01ec826e9e" FOREIGN KEY ("siteId") REFERENCES "sites" ("id") ON DELETE CASCADE ON UPDATE NO ACTION);
    CREATE TABLE IF NOT EXISTS "patrol_schedules" ("id" varchar PRIMARY KEY NOT NULL, "siteId" varchar NOT NULL, "scheduleName" varchar(120) NOT NULL DEFAULT ('Shift'), "expectedGuards" integer NOT NULL DEFAULT (1), "frequencyMinutes" integer NOT NULL, "startHour" integer NOT NULL, "endHour" integer NOT NULL, "is24Hours" boolean NOT NULL DEFAULT (0), "graceMinutes" integer NOT NULL DEFAULT (15), "activeDays" text NOT NULL, "active" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_3a5d0202d2085be36548902dd2b" FOREIGN KEY ("siteId") REFERENCES "sites" ("id") ON DELETE CASCADE ON UPDATE NO ACTION);
    CREATE TABLE IF NOT EXISTS "patrol_images" ("id" varchar PRIMARY KEY NOT NULL, "siteId" varchar NOT NULL, "groupId" varchar, "collectorType" text NOT NULL, "senderName" varchar(120), "senderNumber" varchar(30), "senderExternalId" varchar(120), "messageExternalId" varchar(120), "linkedAccountId" varchar(120), "sentAt" datetime NOT NULL, "receivedAt" datetime NOT NULL, "patrolDate" date NOT NULL, "patrolHour" integer NOT NULL, "originalFileName" varchar(255), "storedFileName" varchar(255) NOT NULL, "filePath" varchar(600) NOT NULL, "fileSize" integer NOT NULL, "mimeType" varchar(100) NOT NULL, "contentSha256" varchar(64), "integrityStatus" varchar(32) NOT NULL DEFAULT ('FINALIZED'), "status" text NOT NULL, "notes" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_a9ed49bfeb9709fb8d6e6d326d8" FOREIGN KEY ("siteId") REFERENCES "sites" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_e2fdd22040ed0a95fcbf443bd9e" FOREIGN KEY ("groupId") REFERENCES "patrol_groups" ("id") ON DELETE SET NULL ON UPDATE NO ACTION);
    CREATE TABLE IF NOT EXISTS "patrol_slots" ("id" varchar PRIMARY KEY NOT NULL, "siteId" varchar NOT NULL, "slotStart" datetime NOT NULL, "slotEnd" datetime NOT NULL, "expectedAt" datetime NOT NULL, "status" text NOT NULL DEFAULT ('PENDING'), "imageId" varchar, "resolvedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "REL_50510e6b381fe90e289b8eb94e" UNIQUE ("imageId"), CONSTRAINT "FK_927fb76c1ea7f7e4a1d00060f18" FOREIGN KEY ("siteId") REFERENCES "sites" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_50510e6b381fe90e289b8eb94e1" FOREIGN KEY ("imageId") REFERENCES "patrol_images" ("id") ON DELETE SET NULL ON UPDATE NO ACTION);
    CREATE TABLE IF NOT EXISTS "patrol_alerts" ("id" varchar PRIMARY KEY NOT NULL, "siteId" varchar NOT NULL, "slotId" varchar, "guardId" varchar, "alertType" text NOT NULL, "alertMessage" varchar(255) NOT NULL, "alertTime" datetime NOT NULL, "isResolved" boolean NOT NULL DEFAULT (0), "resolvedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_5d92b64cf0044a9a67a85ad0390" FOREIGN KEY ("siteId") REFERENCES "sites" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_7bf77408c62f8e45d9b4c16fc03" FOREIGN KEY ("slotId") REFERENCES "patrol_slots" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_5287126dca6af7ea793c99a2ed7" FOREIGN KEY ("guardId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION);
    CREATE TABLE IF NOT EXISTS "incidents" ("id" varchar PRIMARY KEY NOT NULL, "guardId" varchar NOT NULL, "companyId" varchar NOT NULL, "siteId" varchar NOT NULL, "description" text NOT NULL, "severity" text NOT NULL, "status" text NOT NULL DEFAULT ('OPEN'), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_f88e3f31990fdf386f50ee21671" FOREIGN KEY ("guardId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION, CONSTRAINT "FK_574744dd392691b38d632675043" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_ed26d2d272ec84baa26751ea6cd" FOREIGN KEY ("siteId") REFERENCES "sites" ("id") ON DELETE CASCADE ON UPDATE NO ACTION);
    CREATE TABLE IF NOT EXISTS "guard_sender_mappings" ("id" varchar PRIMARY KEY NOT NULL, "guardId" varchar NOT NULL, "senderNumber" varchar(30) NOT NULL, "senderDisplayName" varchar(120), "active" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_8c8c6b287f34f1d288b6196928b" FOREIGN KEY ("guardId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION);
    CREATE TABLE IF NOT EXISTS "shift_guard_assignments" ("id" varchar PRIMARY KEY NOT NULL, "siteId" varchar NOT NULL, "groupId" varchar, "guardId" varchar NOT NULL, "shiftDate" date NOT NULL, "startHour" integer NOT NULL, "endHour" integer NOT NULL, "active" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_35d3a8547ba1ec2e4e7b3eb120f" FOREIGN KEY ("siteId") REFERENCES "sites" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_a2feb7f95f08445d55fe132b623" FOREIGN KEY ("groupId") REFERENCES "patrol_groups" ("id") ON DELETE SET NULL ON UPDATE NO ACTION, CONSTRAINT "FK_1f8938867770f2696a147bdb3b7" FOREIGN KEY ("guardId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION);
    CREATE TABLE IF NOT EXISTS "refresh_tokens" ("id" varchar PRIMARY KEY NOT NULL, "userId" varchar NOT NULL, "tokenHash" varchar(128) NOT NULL, "expiresAt" datetime NOT NULL, "revokedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_610102b60fea1455310ccd299de" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION);
    CREATE UNIQUE INDEX IF NOT EXISTS "IDX_2dd1a55e74185d670ae22cf6dd" ON "companies" ("companyName");
    CREATE UNIQUE INDEX IF NOT EXISTS "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email");
    CREATE UNIQUE INDEX IF NOT EXISTS "IDX_b42b32ad2060d85ac793669e31" ON "sites" ("siteCode");
    CREATE INDEX IF NOT EXISTS "IDX_610102b60fea1455310ccd299d" ON "refresh_tokens" ("userId");
    CREATE UNIQUE INDEX IF NOT EXISTS "IDX_c25bc63d248ca90e8dcc1d92d0" ON "refresh_tokens" ("tokenHash");
  `);
  verifyCoreSchema(database);
}

function applyDurabilitySchema(database) {
  createBaselineSchema(database);
  ensureColumn(database, 'patrol_groups', 'sourceType', "varchar(20) NOT NULL DEFAULT ('group')");
  ensureColumn(database, 'patrol_groups', 'linkedAccountId', 'varchar(120)');
  ensureColumn(database, 'patrol_schedules', 'scheduleName', "varchar(120) NOT NULL DEFAULT ('Shift')");
  ensureColumn(database, 'patrol_schedules', 'expectedGuards', 'integer NOT NULL DEFAULT (1)');
  ensureColumn(database, 'patrol_schedules', 'is24Hours', 'boolean NOT NULL DEFAULT (0)');
  ensureColumn(database, 'sites', 'archivedAt', 'datetime');
  ensureColumn(database, 'patrol_images', 'senderExternalId', 'varchar(120)');
  ensureColumn(database, 'patrol_images', 'linkedAccountId', 'varchar(120)');
  ensureColumn(database, 'patrol_images', 'contentSha256', 'varchar(64)');
  ensureColumn(database, 'patrol_images', 'integrityStatus', "varchar(32) NOT NULL DEFAULT ('FINALIZED')");
  database.exec(`CREATE TABLE IF NOT EXISTS "patrol_migration_conflicts" (
    "id" varchar(200) PRIMARY KEY NOT NULL,
    "kind" varchar(80) NOT NULL,
    "recordId" varchar(160) NOT NULL,
    "detectedAt" datetime NOT NULL DEFAULT (datetime('now')),
    "resolvedAt" datetime
  )`);
  const conflictingMappings = database.prepare(`
    SELECT "id"
    FROM "patrol_groups"
    WHERE "active" = 1
      AND "linkedAccountId" IS NOT NULL
      AND "externalGroupId" IS NOT NULL
      AND ("linkedAccountId", "externalGroupId") IN (
        SELECT "linkedAccountId", "externalGroupId"
        FROM "patrol_groups"
        WHERE "active" = 1
          AND "linkedAccountId" IS NOT NULL
          AND "externalGroupId" IS NOT NULL
        GROUP BY "linkedAccountId", "externalGroupId"
        HAVING COUNT(*) > 1
      )
  `).all();
  const recordConflict = database.prepare(`INSERT OR IGNORE INTO "patrol_migration_conflicts" ("id", "kind", "recordId") VALUES (?, 'DUPLICATE_ACTIVE_ACCOUNT_GROUP_MAPPING', ?)`);
  const pauseMapping = database.prepare('UPDATE "patrol_groups" SET "active" = 0, "updatedAt" = datetime(\'now\') WHERE "id" = ?');
  for (const mapping of conflictingMappings) {
    recordConflict.run(`mapping-conflict-${mapping.id}`, mapping.id);
    pauseMapping.run(mapping.id);
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS "refresh_tokens" ("id" varchar PRIMARY KEY NOT NULL, "userId" varchar NOT NULL, "tokenHash" varchar(128) NOT NULL, "expiresAt" datetime NOT NULL, "revokedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_refresh_tokens_userId" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS "IDX_patrol_groups_linkedAccountId" ON "patrol_groups" ("linkedAccountId");
    CREATE UNIQUE INDEX IF NOT EXISTS "UQ_patrol_groups_active_linked_external" ON "patrol_groups" ("linkedAccountId", "externalGroupId") WHERE "active" = 1 AND "linkedAccountId" IS NOT NULL AND "externalGroupId" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "UQ_patrol_images_whatsapp_identity" ON "patrol_images" ("linkedAccountId", "messageExternalId") WHERE "collectorType" = 'WHATSAPP' AND "linkedAccountId" IS NOT NULL AND "messageExternalId" IS NOT NULL;
  `);
}

const SQLITE_MIGRATIONS = [
  { id: BASELINE_MIGRATION_ID, version: 1, apply: createBaselineSchema },
  { id: DURABILITY_MIGRATION_ID, version: 2, apply: applyDurabilitySchema },
];

function readAppliedMigrations(database) {
  if (!tableNames(database).has(MIGRATION_TABLE)) return new Set();
  return new Set(database.prepare(`SELECT "id" FROM "${MIGRATION_TABLE}"`).all().map((row) => String(row.id)));
}

function getSchemaVersion(database) {
  const applied = readAppliedMigrations(database);
  return SQLITE_MIGRATIONS.reduce((version, migration) => (applied.has(migration.id) ? migration.version : version), 0);
}

function countUnresolvedMappingConflicts(database) {
  if (!tableNames(database).has('patrol_migration_conflicts')) return 0;
  return Number(
    database
      .prepare(
        `SELECT COUNT(*) AS "count" FROM "patrol_migration_conflicts" WHERE "resolvedAt" IS NULL`,
      )
      .get().count,
  );
}

function writeFileAtomic(filePath, contents) {
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, contents, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function normalizeDurabilityStorageError(error) {
  if (error?.code === 'ENOSPC') {
    const storageError = new Error('Storage full or insufficient space. Free disk space or choose another backup location.');
    storageError.code = 'PATROLSAFE_INSUFFICIENT_SPACE';
    storageError.cause = error;
    return storageError;
  }
  return error;
}

function backupSqliteDatabase(sourcePath, destinationPath, options = {}) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  if (fs.existsSync(destinationPath)) throw new Error('Backup database destination already exists');
  const database = openDatabase(sourcePath, options);
  try {
    database.pragma('wal_checkpoint(FULL)');
    database.prepare('VACUUM INTO ?').run(destinationPath);
  } finally {
    database.close();
  }
  integrityCheck(destinationPath, options);
  return sha256(fs.readFileSync(destinationPath));
}

function createPreUpgradeBackup(params) {
  const backupRoot = path.resolve(params.backupRoot);
  fs.mkdirSync(backupRoot, { recursive: true });
  const stem = `pre-upgrade-schema-${params.fromVersion}-to-${params.toVersion}-${timestampForPath()}`;
  const databaseBackupPath = path.join(backupRoot, `${stem}.db`);
  const databaseSha256 = backupSqliteDatabase(params.databasePath, databaseBackupPath, params);
  const metadataPath = `${databaseBackupPath}.json`;
  writeFileAtomic(
    metadataPath,
    JSON.stringify(
      {
        kind: 'PatrolSafe pre-upgrade SQLite backup',
        createdAt: new Date().toISOString(),
        fromSchemaVersion: params.fromVersion,
        toSchemaVersion: params.toVersion,
        appVersion: params.appVersion,
        buildId: params.buildId,
        databaseSha256,
      },
      null,
      2,
    ),
  );
  const backups = fs
    .readdirSync(backupRoot)
    .filter((name) => /^pre-upgrade-schema-.*\.db$/.test(name))
    .sort()
    .reverse();
  for (const stale of backups.slice(PRE_UPGRADE_RETENTION)) {
    fs.rmSync(path.join(backupRoot, stale), { force: true });
    fs.rmSync(path.join(backupRoot, `${stale}.json`), { force: true });
  }
  return { databaseBackupPath, metadataPath, databaseSha256 };
}

function prepareSqliteDatabase(params) {
  const databasePath = path.resolve(params.databasePath);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const existed = fs.existsSync(databasePath) && fs.statSync(databasePath).size > 0;
  if (existed) integrityCheck(databasePath, params);

  const database = openDatabase(databasePath, params);
  let applied = [];
  let preUpgradeBackup = null;
  let unresolvedMappingConflictsBefore = 0;
  try {
    const existingTables = tableNames(database);
    unresolvedMappingConflictsBefore = countUnresolvedMappingConflicts(database);
    const priorVersion = getSchemaVersion(database);
    const pending = SQLITE_MIGRATIONS.filter((migration) => !readAppliedMigrations(database).has(migration.id));
    if (pending.length === 0) {
      verifyCoreSchema(database);
      return {
        schemaVersion: priorVersion,
        applied,
        adopted: false,
        preUpgradeBackup: null,
        mappingConflictsPaused: 0,
        mappingConflictsUnresolved: unresolvedMappingConflictsBefore,
      };
    }

    if (existed && existingTables.size > 0) {
      database.close();
      preUpgradeBackup = createPreUpgradeBackup({
        ...params,
        databasePath,
        backupRoot: params.preUpgradeBackupRoot,
        fromVersion: priorVersion,
        toVersion: CURRENT_SQLITE_SCHEMA_VERSION,
      });
    }
  } finally {
    if (database.open) database.close();
  }

  const migrationDatabase = openDatabase(databasePath, params);
  try {
    migrationDatabase.pragma('foreign_keys = ON');
    migrationDatabase.exec(`CREATE TABLE IF NOT EXISTS "${MIGRATION_TABLE}" ("id" varchar(160) PRIMARY KEY NOT NULL, "version" integer NOT NULL DEFAULT (0), "appliedAt" datetime NOT NULL DEFAULT (datetime('now')))`);
    const migrationColumns = columnNames(migrationDatabase, MIGRATION_TABLE);
    if (!migrationColumns.has('version')) {
      migrationDatabase.exec(`ALTER TABLE "${MIGRATION_TABLE}" ADD COLUMN "version" integer NOT NULL DEFAULT (0)`);
    }
    for (const migration of SQLITE_MIGRATIONS) {
      const alreadyApplied = migrationDatabase.prepare(`SELECT 1 FROM "${MIGRATION_TABLE}" WHERE "id" = ?`).get(migration.id);
      if (alreadyApplied) continue;
      const transaction = migrationDatabase.transaction(() => {
        if (params.failMigrationId === migration.id) throw new Error(`Injected migration failure: ${migration.id}`);
        migration.apply(migrationDatabase);
        migrationDatabase
          .prepare(`INSERT INTO "${MIGRATION_TABLE}" ("id", "version") VALUES (?, ?)`)
          .run(migration.id, migration.version);
      });
      transaction();
      applied.push(migration.id);
    }
    verifyCoreSchema(migrationDatabase);
    const result = migrationDatabase.pragma('integrity_check');
    if (String(result[0]?.integrity_check || '').toLowerCase() !== 'ok') {
      throw new Error('SQLite migration completed with an invalid database');
    }
    const mappingConflictsUnresolved = countUnresolvedMappingConflicts(migrationDatabase);
    return {
      schemaVersion: getSchemaVersion(migrationDatabase),
      applied,
      adopted: existed,
      preUpgradeBackup,
      mappingConflictsPaused: Math.max(mappingConflictsUnresolved - unresolvedMappingConflictsBefore, 0),
      mappingConflictsUnresolved,
    };
  } catch (error) {
    error.code ||= 'PATROLSAFE_MIGRATION_FAILED';
    error.preUpgradeBackup = preUpgradeBackup?.databaseBackupPath || null;
    throw error;
  } finally {
    migrationDatabase.close();
  }
}

async function hashFile(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function collectRegularFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  async function walk(directory) {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const stat = await fs.promises.lstat(fullPath);
      if (stat.isSymbolicLink()) throw new Error('Backup source contains an unsupported symbolic link');
      if (stat.isDirectory()) await walk(fullPath);
      else if (stat.isFile()) files.push({ fullPath, size: stat.size });
    }
  }
  await walk(root);
  return files.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
}

async function assertFreeSpace(targetRoot, requiredBytes) {
  let probe = path.resolve(targetRoot);
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) {
    probe = path.dirname(probe);
  }
  const stats = await fs.promises.statfs(probe);
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  const requiredWithHeadroom = Math.ceil(requiredBytes * 1.1) + MIN_FREE_SPACE_HEADROOM;
  if (availableBytes < requiredWithHeadroom) {
    const error = new Error('Storage full or insufficient space. Free disk space or choose another backup location.');
    error.code = 'PATROLSAFE_INSUFFICIENT_SPACE';
    error.availableBytes = availableBytes;
    error.requiredBytes = requiredWithHeadroom;
    throw error;
  }
  return { availableBytes, requiredBytes: requiredWithHeadroom };
}

async function copyDirectoryWithManifest(sourceRoot, destinationRoot) {
  const sourceFiles = await collectRegularFiles(sourceRoot);
  const manifestFiles = [];
  // Empty evidence/session directories are meaningful and must survive a
  // backup/restore round-trip just as reliably as non-empty directories.
  await fs.promises.mkdir(destinationRoot, { recursive: true });
  for (const file of sourceFiles) {
    const relativePath = path.relative(sourceRoot, file.fullPath);
    const safeRelative = normalizeRelativePath(relativePath);
    const destination = ensureContained(destinationRoot, path.join(destinationRoot, safeRelative));
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(file.fullPath, destination, fs.constants.COPYFILE_EXCL);
    manifestFiles.push({
      path: safeRelative.replace(/\\/g, '/'),
      bytes: file.size,
      sha256: await hashFile(destination),
    });
  }
  return manifestFiles;
}

function evidenceAggregateHash(files) {
  return sha256(files.map((file) => `${file.path}|${file.bytes}|${file.sha256}`).sort().join('\n'));
}

function resolveWorkspaceIdHash(databasePath, options = {}) {
  try {
    const database = openDatabase(databasePath, { ...options, readonly: true });
    try {
      const rows = database.prepare('SELECT "id" FROM "companies" ORDER BY "id"').all();
      return sha256(rows.map((row) => String(row.id)).join('|'));
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
}

function verifyDatabaseEvidenceReferences(databasePath, evidenceRoot, evidenceFiles, options = {}) {
  const database = openDatabase(databasePath, { ...options, readonly: true });
  try {
    if (!tableNames(database).has('patrol_images')) {
      return { rowCount: 0, referencedFileCount: 0, orphanFileCount: evidenceFiles.length };
    }
    const rows = database.prepare('SELECT "id", "filePath", "fileSize", "contentSha256" FROM "patrol_images"').all();
    const byPath = new Map(evidenceFiles.map((entry) => [entry.path.replace(/\\/g, '/'), entry]));
    const referenced = new Set();
    for (const row of rows) {
      const relative = path.relative(path.resolve(evidenceRoot), path.resolve(String(row.filePath))).replace(/\\/g, '/');
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Evidence database record points outside the managed evidence root');
      }
      const entry = byPath.get(relative);
      if (!entry) throw new Error('Evidence database record is missing from the backup evidence set');
      if (Number(row.fileSize) !== Number(entry.bytes)) {
        throw new Error('Evidence database file size does not match managed evidence');
      }
      if (row.contentSha256 && String(row.contentSha256).toLowerCase() !== String(entry.sha256).toLowerCase()) {
        throw new Error('Evidence database hash does not match managed evidence');
      }
      referenced.add(relative);
    }
    return {
      rowCount: rows.length,
      referencedFileCount: referenced.size,
      orphanFileCount: evidenceFiles.length - referenced.size,
    };
  } finally {
    database.close();
  }
}

function evidenceRows(databasePath, options = {}) {
  const database = openDatabase(databasePath, { ...options, readonly: true });
  try {
    return database.prepare(`
      SELECT image."id", image."filePath", image."fileSize", image."contentSha256",
             image."storedFileName", image."mimeType", image."patrolDate", image."patrolHour",
             site."siteCode"
      FROM "patrol_images" image
      JOIN "sites" site ON site."id" = image."siteId"
      ORDER BY image."id"
    `).all();
  } finally {
    database.close();
  }
}

function assertNoReparseComponents(filePath) {
  const absolute = path.resolve(filePath);
  let component = path.parse(absolute).root;
  for (const part of path.relative(component, absolute).split(path.sep)) {
    component = path.join(component, part);
    const stat = fs.lstatSync(component);
    if (stat.isSymbolicLink() || (stat.isDirectory() && part === '..')) {
      throw new Error('Evidence source contains an unsupported link or reparse point');
    }
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile()) throw new Error('Evidence source is not a regular file');
  return stat;
}

function assertHistoricalEvidenceShape(row, filePath) {
  const parts = path.resolve(filePath).split(path.sep);
  const filename = parts.at(-1);
  const date = String(row.patrolDate || '').slice(0, 10);
  const hour = `${String(row.patrolHour).padStart(2, '0')}00`;
  const siteCode = String(row.siteCode || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  const hourIndex = parts.length - (parts.at(-2) === hour ? 2 : 3);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) ||
      !Number.isInteger(Number(row.patrolHour)) || Number(row.patrolHour) < 0 || Number(row.patrolHour) > 23 ||
      filename !== row.storedFileName || parts[hourIndex] !== hour ||
      parts[hourIndex - 1] !== date || parts[hourIndex - 2] !== siteCode ||
      (parts.length - hourIndex !== 2 && parts.length - hourIndex !== 3)) {
    throw new Error('Historical evidence path does not match its authoritative site/date/hour record');
  }
  const extension = path.extname(filename).toLowerCase();
  if ((row.mimeType === 'image/jpeg' && !['.jpg', '.jpeg'].includes(extension)) ||
      (row.mimeType === 'image/png' && extension !== '.png') ||
      !['image/jpeg', 'image/png'].includes(row.mimeType)) {
    throw new Error('Historical evidence type does not match its authoritative record');
  }
  const header = Buffer.alloc(8);
  const handle = fs.openSync(filePath, 'r');
  try {
    fs.readSync(handle, header, 0, header.length, 0);
  } finally {
    fs.closeSync(handle);
  }
  if ((row.mimeType === 'image/jpeg' && !header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) ||
      (row.mimeType === 'image/png' && !header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))) {
    throw new Error('Historical evidence file is not the recorded image type');
  }
}

async function copyAuthoritativeEvidence(rows, evidenceRoot, destinationRoot) {
  const root = path.resolve(evidenceRoot);
  const realRoot = fs.existsSync(root) ? fs.realpathSync.native(root) : root;
  const files = new Map();
  const records = [];
  await fs.promises.mkdir(destinationRoot, { recursive: true });
  for (const row of rows) {
    const rawPath = String(row.filePath || '');
    if (!path.isAbsolute(rawPath) || rawPath.split(/[\\/]/).includes('..')) {
      throw new Error('Evidence database record contains an unsafe source path');
    }
    if (process.platform === 'win32' && (!/^[a-zA-Z]:[\\/]/.test(rawPath) || rawPath.startsWith('\\\\'))) {
      throw new Error('Historical evidence must be a local filesystem file');
    }
    const source = path.resolve(rawPath);
    const stat = assertNoReparseComponents(source);
    const realSource = fs.realpathSync.native(source);
    if (path.normalize(realSource).toLowerCase() !== path.normalize(source).toLowerCase()) {
      throw new Error('Evidence source resolves through an unsupported link or reparse point');
    }
    const relative = path.relative(realRoot, realSource);
    const inCurrentRoot = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    if (!inCurrentRoot) assertHistoricalEvidenceShape(row, source);
    if (stat.size !== Number(row.fileSize)) throw new Error('Evidence database file size does not match source');
    const sourceHash = await hashFile(source);
    if (row.contentSha256 && sourceHash.toLowerCase() !== String(row.contentSha256).toLowerCase()) {
      throw new Error('Evidence database hash does not match source');
    }
    const extension = row.mimeType === 'image/png' ? '.png' : '.jpg';
    const archivePath = inCurrentRoot
      ? `current-root/${normalizeRelativePath(relative).replace(/\\/g, '/')}`
      : `historical/${sha256(String(row.id))}/evidence${extension}`;
    const destination = ensureContained(destinationRoot, path.join(destinationRoot, normalizeRelativePath(archivePath)));
    if (!files.has(archivePath)) {
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
      const copiedHash = await hashFile(destination);
      if (copiedHash !== sourceHash || fs.statSync(destination).size !== stat.size) {
        throw new Error('Evidence changed while being copied into backup');
      }
      files.set(archivePath, { path: archivePath, bytes: stat.size, sha256: copiedHash });
    } else if (files.get(archivePath).sha256 !== sourceHash || files.get(archivePath).bytes !== stat.size) {
      throw new Error('Evidence records disagree about a shared physical file');
    }
    records.push({ id: String(row.id), path: archivePath });
  }
  return { files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), records };
}

function rewriteBackupDatabaseEvidencePaths(databasePath, records, options = {}) {
  const database = openDatabase(databasePath, options);
  try {
    database.pragma('secure_delete = ON');
    const update = database.prepare('UPDATE "patrol_images" SET "filePath" = ? WHERE "id" = ?');
    database.transaction(() => {
      for (const record of records) {
        if (update.run(`${PORTABLE_EVIDENCE_PREFIX}${record.path}`, record.id).changes !== 1) {
          throw new Error('Backup evidence identity changed during snapshot');
        }
      }
    })();
    database.exec('VACUUM');
  } finally {
    database.close();
  }
}

function verifyPortableEvidenceReferences(databasePath, evidence, options = {}) {
  const records = Array.isArray(evidence.records) ? evidence.records : [];
  const files = new Map(evidence.files.map((file) => [file.path, file]));
  const byId = new Map();
  for (const record of records) {
    const id = String(record.id || '');
    const archivePath = normalizeRelativePath(record.path).replace(/\\/g, '/');
    if (!id || byId.has(id) || !files.has(archivePath) ||
        (!archivePath.startsWith('current-root/') && !/^historical\/[a-f0-9]{64}\/evidence\.(jpg|png)$/.test(archivePath)) ||
        (archivePath.startsWith('historical/') && archivePath.split('/')[1] !== sha256(id))) {
      throw new Error('Backup contains an invalid evidence identity mapping');
    }
    byId.set(id, archivePath);
  }
  const database = openDatabase(databasePath, { ...options, readonly: true });
  try {
    const rows = database.prepare('SELECT "id", "filePath", "fileSize", "contentSha256" FROM "patrol_images"').all();
    if (rows.length !== records.length) throw new Error('Backup evidence identity count mismatch');
    const referenced = new Set();
    for (const row of rows) {
      const archivePath = byId.get(String(row.id));
      const entry = files.get(archivePath);
      if (!entry || row.filePath !== `${PORTABLE_EVIDENCE_PREFIX}${archivePath}` ||
          Number(row.fileSize) !== Number(entry.bytes) ||
          (row.contentSha256 && String(row.contentSha256).toLowerCase() !== entry.sha256.toLowerCase())) {
        throw new Error('Backup evidence/database identity or integrity mismatch');
      }
      referenced.add(archivePath);
    }
    return { rowCount: rows.length, referencedFileCount: referenced.size, orphanFileCount: files.size - referenced.size };
  } finally {
    database.close();
  }
}

function sameMachineFiles(userDataRoot) {
  return [...SAME_MACHINE_COMPONENTS].map((relativePath) => ({
    relativePath,
    sourcePath: path.join(userDataRoot, relativePath),
  }));
}

async function createPatrolSafeBackup(params) {
  const databasePath = path.resolve(params.databasePath);
  const evidenceRoot = path.resolve(params.evidenceRoot);
  const configPath = path.resolve(params.configPath);
  const userDataRoot = path.resolve(params.userDataRoot);
  const destinationParent = path.resolve(params.destinationParent);
  if (!fs.existsSync(databasePath)) throw new Error('PatrolSafe database does not exist');
  integrityCheck(databasePath, params);
  const sourceEvidenceRows = evidenceRows(databasePath, params);
  const machineSources = sameMachineFiles(userDataRoot);
  let estimatedBytes = fs.statSync(databasePath).size + sourceEvidenceRows.reduce((sum, row) => sum + Number(row.fileSize), 0);
  if (fs.existsSync(configPath)) estimatedBytes += fs.statSync(configPath).size;
  for (const source of machineSources) {
    if (!fs.existsSync(source.sourcePath)) continue;
    const stat = fs.statSync(source.sourcePath);
    estimatedBytes += stat.isDirectory()
      ? (await collectRegularFiles(source.sourcePath)).reduce((sum, file) => sum + file.size, 0)
      : stat.size;
  }
  try {
    await fs.promises.mkdir(destinationParent, { recursive: true });
  } catch (error) {
    throw normalizeDurabilityStorageError(error);
  }
  await assertFreeSpace(destinationParent, estimatedBytes);

  const backupName = `PatrolSafe-backup-${timestampForPath()}`;
  const stagingRoot = ensureContained(destinationParent, path.join(destinationParent, `.${backupName}.staging-${crypto.randomUUID()}`));
  const finalRoot = ensureContained(destinationParent, path.join(destinationParent, backupName));
  try {
    await fs.promises.mkdir(stagingRoot, { recursive: false });
    const databaseDestination = path.join(stagingRoot, 'database', 'patrol-evidence.db');
    backupSqliteDatabase(databasePath, databaseDestination, params);
    const snapshotEvidenceRows = evidenceRows(databaseDestination, params);
    const { files: evidenceFiles, records: evidenceRecords } = await copyAuthoritativeEvidence(
      snapshotEvidenceRows, evidenceRoot, path.join(stagingRoot, 'evidence'),
    );
    rewriteBackupDatabaseEvidencePaths(databaseDestination, evidenceRecords, params);
    const databaseSha256 = await hashFile(databaseDestination);
    const evidenceDatabase = verifyPortableEvidenceReferences(
      databaseDestination, { files: evidenceFiles, records: evidenceRecords }, params,
    );
    let configurationManifest = { included: false, path: 'config/workspace-config.json' };
    if (fs.existsSync(configPath)) {
      await fs.promises.mkdir(path.join(stagingRoot, 'config'), { recursive: true });
      const configDestination = path.join(stagingRoot, 'config', 'workspace-config.json');
      await fs.promises.copyFile(configPath, configDestination, fs.constants.COPYFILE_EXCL);
      configurationManifest = {
        included: true,
        path: 'config/workspace-config.json',
        bytes: fs.statSync(configDestination).size,
        sha256: await hashFile(configDestination),
      };
    }

    const sameMachineManifest = [];
    for (const source of machineSources) {
      if (!fs.existsSync(source.sourcePath)) continue;
      const target = ensureContained(stagingRoot, path.join(stagingRoot, 'same-machine', normalizeRelativePath(source.relativePath)));
      if (fs.statSync(source.sourcePath).isDirectory()) {
        const files = await copyDirectoryWithManifest(source.sourcePath, target);
        sameMachineManifest.push({ path: source.relativePath.replace(/\\/g, '/'), kind: 'directory', files });
      } else {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.copyFile(source.sourcePath, target, fs.constants.COPYFILE_EXCL);
        sameMachineManifest.push({
          path: source.relativePath.replace(/\\/g, '/'),
          kind: 'file',
          bytes: fs.statSync(target).size,
          sha256: await hashFile(target),
        });
      }
    }

    const database = openDatabase(databaseDestination, { ...params, readonly: true });
    let schemaVersion;
    try {
      schemaVersion = getSchemaVersion(database);
    } finally {
      database.close();
    }
    const manifest = {
      format: 'PatrolSafeBackup',
      formatVersion: BACKUP_FORMAT_VERSION,
      complete: true,
      createdAt: new Date().toISOString(),
      patrolSafeVersion: params.appVersion,
      buildId: params.buildId,
      schemaVersion,
      workspaceIdHash: resolveWorkspaceIdHash(databaseDestination, params),
      database: {
        path: 'database/patrol-evidence.db',
        bytes: fs.statSync(databaseDestination).size,
        sha256: databaseSha256,
      },
      evidence: {
        fileCount: evidenceFiles.length,
        totalBytes: evidenceFiles.reduce((sum, file) => sum + file.bytes, 0),
        aggregateSha256: evidenceAggregateHash(evidenceFiles),
        ...evidenceDatabase,
        files: evidenceFiles,
        records: evidenceRecords,
      },
      configuration: configurationManifest,
      sameMachine: {
        included: sameMachineManifest.length > 0,
        machineBindingHash: params.machineBindingHash || getMachineBindingHash(),
        portability: 'SAME_MACHINE_ONLY',
        components: sameMachineManifest,
      },
      includedComponents: ['database', 'evidence', 'workspace-configuration', 'same-machine-state'],
      excludedComponents: [
        'logs',
        'temporary-files',
        'staging-files',
        'registry-state',
        'desktop-login-session',
        'jwt-secret',
        'desktop-api-token',
        'desktop-recovery-authority',
      ],
      replacementMachinePolicy: 'WhatsApp relink and licence recovery are required; evidence, sites and mappings remain available.',
    };
    writeFileAtomic(path.join(stagingRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await verifyPatrolSafeBackup(stagingRoot, params);
    await fs.promises.rename(stagingRoot, finalRoot);
    return { backupPath: finalRoot, manifest };
  } catch (error) {
    await fs.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw normalizeDurabilityStorageError(error);
  }
}

async function verifyPatrolSafeBackup(backupRoot, options = {}) {
  const root = path.resolve(backupRoot);
  const manifestPath = ensureContained(root, path.join(root, 'manifest.json'));
  const manifest = safeJsonRead(manifestPath);
  if (manifest.format !== 'PatrolSafeBackup' ||
      ![LEGACY_BACKUP_FORMAT_VERSION, BACKUP_FORMAT_VERSION].includes(manifest.formatVersion) ||
      manifest.complete !== true) {
    throw new Error('Unsupported or incomplete PatrolSafe backup');
  }
  if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion > CURRENT_SQLITE_SCHEMA_VERSION) {
    throw new Error('This backup requires a newer supported PatrolSafe version');
  }
  const databaseRelative = normalizeRelativePath(manifest.database?.path);
  const databasePath = ensureContained(root, path.join(root, databaseRelative), 'Backup database path');
  const databaseStat = await fs.promises.stat(databasePath);
  if (!databaseStat.isFile() || databaseStat.size !== manifest.database.bytes) {
    throw new Error('Backup database size mismatch');
  }
  if ((await hashFile(databasePath)) !== manifest.database.sha256) throw new Error('Backup database checksum mismatch');
  integrityCheck(databasePath, options);

  const manifestEvidence = Array.isArray(manifest.evidence?.files) ? manifest.evidence.files : [];
  const seen = new Set();
  let totalBytes = 0;
  for (const entry of manifestEvidence) {
    const relative = normalizeRelativePath(entry.path);
    const normalized = relative.replace(/\\/g, '/');
    if (seen.has(normalized)) throw new Error('Backup manifest contains a duplicate evidence path');
    seen.add(normalized);
    const filePath = ensureContained(path.join(root, 'evidence'), path.join(root, 'evidence', relative), 'Evidence backup path');
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size !== entry.bytes) throw new Error('Backup evidence size mismatch');
    if ((await hashFile(filePath)) !== entry.sha256) throw new Error('Backup evidence checksum mismatch');
    totalBytes += stat.size;
  }
  const actualEvidenceFiles = await collectRegularFiles(path.join(root, 'evidence'));
  if (actualEvidenceFiles.length !== manifestEvidence.length) throw new Error('Backup evidence manifest is incomplete');
  if (manifest.evidence.fileCount !== manifestEvidence.length || manifest.evidence.totalBytes !== totalBytes) {
    throw new Error('Backup evidence totals are inconsistent');
  }
  if (manifest.evidence.aggregateSha256 !== evidenceAggregateHash(manifestEvidence)) {
    throw new Error('Backup evidence aggregate checksum mismatch');
  }
  const evidenceDatabase = manifest.formatVersion === LEGACY_BACKUP_FORMAT_VERSION
    ? verifyDatabaseEvidenceReferences(databasePath, manifest.evidence.rootPathAtBackup, manifestEvidence, options)
    : verifyPortableEvidenceReferences(databasePath, manifest.evidence, options);
  if (manifest.formatVersion === BACKUP_FORMAT_VERSION && evidenceDatabase.orphanFileCount !== 0) {
    throw new Error('Portable backup contains evidence not referenced by the database');
  }
  for (const field of ['rowCount', 'referencedFileCount', 'orphanFileCount']) {
    if (manifest.evidence[field] !== evidenceDatabase[field]) {
      throw new Error('Backup evidence/database accounting is inconsistent');
    }
  }

  if (manifest.configuration?.included) {
    const configRelative = normalizeRelativePath(manifest.configuration.path);
    const configPath = ensureContained(root, path.join(root, configRelative), 'Backup configuration path');
    const stat = await fs.promises.stat(configPath);
    if (!stat.isFile() || stat.size !== manifest.configuration.bytes) {
      throw new Error('Backup configuration size mismatch');
    }
    if ((await hashFile(configPath)) !== manifest.configuration.sha256) {
      throw new Error('Backup configuration checksum mismatch');
    }
  }

  const sameMachineRoot = path.join(root, 'same-machine');
  const seenSameMachineComponents = new Set();
  for (const component of manifest.sameMachine?.components || []) {
    const componentRelative = normalizeRelativePath(component.path);
    const portableComponentPath = componentRelative.replace(/\\/g, '/');
    if (!SAME_MACHINE_COMPONENTS.has(portableComponentPath)) {
      throw new Error('Backup manifest contains an unsupported same-machine component path');
    }
    if (seenSameMachineComponents.has(portableComponentPath)) {
      throw new Error('Backup manifest contains a duplicate same-machine component path');
    }
    seenSameMachineComponents.add(portableComponentPath);
    const componentPath = ensureContained(sameMachineRoot, path.join(sameMachineRoot, componentRelative), 'Same-machine backup path');
    if (component.kind === 'file') {
      const stat = await fs.promises.stat(componentPath);
      if (!stat.isFile() || stat.size !== component.bytes || (await hashFile(componentPath)) !== component.sha256) {
        throw new Error('Same-machine backup component checksum mismatch');
      }
      continue;
    }
    if (component.kind !== 'directory' || !Array.isArray(component.files)) {
      throw new Error('Backup manifest contains an unsupported same-machine component');
    }
    const actualFiles = await collectRegularFiles(componentPath);
    if (actualFiles.length !== component.files.length) {
      throw new Error('Same-machine backup component manifest is incomplete');
    }
    for (const entry of component.files) {
      const relative = normalizeRelativePath(entry.path);
      const filePath = ensureContained(componentPath, path.join(componentPath, relative), 'Same-machine component path');
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size !== entry.bytes || (await hashFile(filePath)) !== entry.sha256) {
        throw new Error('Same-machine backup component checksum mismatch');
      }
    }
  }
  return { manifest, databasePath, evidenceFileCount: manifestEvidence.length };
}

function rewriteRestoredEvidencePaths(databasePath, originalEvidenceRoot, targetEvidenceRoot, options = {}) {
  const database = openDatabase(databasePath, options);
  try {
    const rows = database.prepare('SELECT "id", "filePath" FROM "patrol_images"').all();
    const update = database.prepare('UPDATE "patrol_images" SET "filePath" = ? WHERE "id" = ?');
    const transaction = database.transaction(() => {
      for (const row of rows) {
        const source = path.resolve(String(row.filePath));
        const relative = path.relative(path.resolve(originalEvidenceRoot), source);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error('Restored evidence record points outside the backed-up evidence root');
        }
        update.run(path.join(path.resolve(targetEvidenceRoot), relative), row.id);
      }
    });
    transaction();
  } finally {
    database.close();
  }
}

function portableRestoreRelativePath(archivePath) {
  const relative = normalizeRelativePath(archivePath).replace(/\\/g, '/');
  if (relative.startsWith('current-root/')) {
    return normalizeRelativePath(relative.slice('current-root/'.length));
  }
  if (/^historical\/[a-f0-9]{64}\/evidence\.(jpg|png)$/.test(relative)) {
    return normalizeRelativePath(`_PatrolSafe_Historical/${relative.slice('historical/'.length)}`);
  }
  throw new Error('Backup contains an unsupported evidence archive path');
}

async function stagePortableEvidence(backupRoot, stagedEvidence, manifestEvidence) {
  await fs.promises.mkdir(stagedEvidence, { recursive: true });
  const seenDestinations = new Set();
  const stagedFiles = [];
  for (const entry of manifestEvidence.files) {
    const archiveRelative = normalizeRelativePath(entry.path);
    const destinationRelative = portableRestoreRelativePath(entry.path);
    const destinationKey = destinationRelative.toLowerCase();
    if (seenDestinations.has(destinationKey)) throw new Error('Backup evidence restore paths collide');
    seenDestinations.add(destinationKey);
    const source = ensureContained(path.join(backupRoot, 'evidence'), path.join(backupRoot, 'evidence', archiveRelative));
    const destination = ensureContained(stagedEvidence, path.join(stagedEvidence, destinationRelative));
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    const copiedHash = await hashFile(destination);
    if (copiedHash !== entry.sha256 || fs.statSync(destination).size !== Number(entry.bytes)) {
      throw new Error('Restored evidence staging integrity check failed');
    }
    stagedFiles.push({ path: destinationRelative.replace(/\\/g, '/'), bytes: entry.bytes, sha256: copiedHash });
  }
  return stagedFiles;
}

function rewritePortableRestoredEvidencePaths(databasePath, records, targetEvidenceRoot, options = {}) {
  const database = openDatabase(databasePath, options);
  try {
    const update = database.prepare('UPDATE "patrol_images" SET "filePath" = ? WHERE "id" = ?');
    database.transaction(() => {
      for (const record of records) {
        const relative = portableRestoreRelativePath(record.path);
        const destination = ensureContained(targetEvidenceRoot, path.join(targetEvidenceRoot, relative));
        if (update.run(destination, record.id).changes !== 1) {
          throw new Error('Restored evidence identity is missing from the database');
        }
      }
    })();
  } finally {
    database.close();
  }
}

async function restorePatrolSafeBackup(params) {
  const verification = await verifyPatrolSafeBackup(params.backupRoot, params);
  const manifest = verification.manifest;
  const userDataRoot = path.resolve(params.userDataRoot);
  const databasePath = path.resolve(params.databasePath);
  const evidenceRoot = path.resolve(params.evidenceRoot);
  const configPath = path.resolve(params.configPath);
  const sameMachine = manifest.sameMachine?.machineBindingHash === (params.machineBindingHash || getMachineBindingHash());
  const backedCommercialLicence = (manifest.sameMachine?.components || []).find(
    (component) => String(component.path).replace(/\\/g, '/') === 'commercial-licence.tglic',
  );
  let restoreCommercialLicence = false;
  let requiresLicenceRecovery = Boolean(backedCommercialLicence);
  if (sameMachine && backedCommercialLicence && typeof params.validateCommercialLicenceRestore === 'function') {
    try {
      const sameMachineRoot = path.join(params.backupRoot, 'same-machine');
      restoreCommercialLicence = await params.validateCommercialLicenceRestore({
        licencePath: ensureContained(sameMachineRoot, path.join(sameMachineRoot, 'commercial-licence.tglic')),
        identityPath: ensureContained(sameMachineRoot, path.join(sameMachineRoot, 'installation-identity.json')),
      });
      requiresLicenceRecovery = !restoreCommercialLicence;
    } catch {
      restoreCommercialLicence = false;
      requiresLicenceRecovery = true;
    }
  }
  const restoreId = crypto.randomUUID();
  const stagingRoot = ensureContained(userDataRoot, path.join(userDataRoot, `.restore-staging-${restoreId}`));
  const rollbackRoot = ensureContained(userDataRoot, path.join(userDataRoot, `restore-rollback-${timestampForPath()}`));
  await fs.promises.mkdir(stagingRoot, { recursive: false });
  const stagedDatabase = path.join(path.dirname(databasePath), `.${path.basename(databasePath)}.restore-staging-${restoreId}`);
  const stagedEvidence = path.join(path.dirname(evidenceRoot), `.${path.basename(evidenceRoot)}.restore-staging-${restoreId}`);
  const rollbackDatabase = path.join(path.dirname(databasePath), `.${path.basename(databasePath)}.restore-rollback-${timestampForPath()}`);
  const rollbackEvidence = path.join(path.dirname(evidenceRoot), `.${path.basename(evidenceRoot)}.restore-rollback-${timestampForPath()}`);
  const rollbackConfig = path.join(rollbackRoot, 'workspace-config.json');
  try {
    const databaseBytes = fs.statSync(verification.databasePath).size;
    const sameMachineBytes = sameMachine
      ? (manifest.sameMachine?.components || []).reduce((total, component) => {
        if (component.kind === 'file') return total + Number(component.bytes || 0);
        return total + (component.files || []).reduce((componentTotal, file) => componentTotal + Number(file.bytes || 0), 0);
      }, 0)
      : 0;
    const volumeRequirements = new Map();
    const addVolumeRequirement = (targetPath, bytes) => {
      const volume = path.parse(path.resolve(targetPath)).root.toLowerCase();
      const current = volumeRequirements.get(volume) || { targetPath, bytes: 0 };
      current.bytes += bytes;
      volumeRequirements.set(volume, current);
    };
    addVolumeRequirement(path.dirname(databasePath), databaseBytes);
    addVolumeRequirement(path.dirname(evidenceRoot), Number(manifest.evidence.totalBytes || 0));
    addVolumeRequirement(userDataRoot, sameMachineBytes + Number(manifest.configuration?.bytes || 0));
    for (const requirement of volumeRequirements.values()) {
      await assertFreeSpace(requirement.targetPath, requirement.bytes);
    }

    await fs.promises.mkdir(path.dirname(stagedDatabase), { recursive: true });
    await fs.promises.copyFile(verification.databasePath, stagedDatabase, fs.constants.COPYFILE_EXCL);
    let stagedEvidenceFiles;
    if (manifest.formatVersion === LEGACY_BACKUP_FORMAT_VERSION) {
      stagedEvidenceFiles = await copyDirectoryWithManifest(path.join(params.backupRoot, 'evidence'), stagedEvidence);
      rewriteRestoredEvidencePaths(stagedDatabase, manifest.evidence.rootPathAtBackup, evidenceRoot, params);
    } else {
      stagedEvidenceFiles = await stagePortableEvidence(params.backupRoot, stagedEvidence, manifest.evidence);
      rewritePortableRestoredEvidencePaths(stagedDatabase, manifest.evidence.records, evidenceRoot, params);
    }
    integrityCheck(stagedDatabase, params);
    verifyDatabaseEvidenceReferences(stagedDatabase, evidenceRoot, stagedEvidenceFiles, params);
    const stagedConfig = path.join(stagingRoot, 'workspace-config.json');
    const backedConfigPath = path.join(params.backupRoot, 'config', 'workspace-config.json');
    if (fs.existsSync(backedConfigPath)) {
      const restoredConfig = safeJsonRead(backedConfigPath);
      restoredConfig.dbType = 'sqlite';
      restoredConfig.sqliteDbPath = databasePath;
      restoredConfig.storageRootPath = evidenceRoot;
      if (!sameMachine) {
        restoredConfig.autoStartCollector = false;
        delete restoredConfig.licenseKey;
        delete restoredConfig.licenseType;
        delete restoredConfig.licenseStatus;
        delete restoredConfig.trialStartDate;
        delete restoredConfig.trialEndDate;
      }
      writeFileAtomic(stagedConfig, JSON.stringify(restoredConfig, null, 2));
    }

    await fs.promises.mkdir(rollbackRoot, { recursive: false });
    let databaseMoved = false;
    let evidenceMoved = false;
    let configMoved = false;
    let configActivated = false;
    const sameMachineActions = [];
    try {
      if (fs.existsSync(databasePath)) {
        await fs.promises.rename(databasePath, rollbackDatabase);
        databaseMoved = true;
      }
      await fs.promises.mkdir(path.dirname(databasePath), { recursive: true });
      await fs.promises.rename(stagedDatabase, databasePath);
      if (params.failRestoreAfter === 'database') throw new Error('Injected restore activation failure after database');

      if (fs.existsSync(evidenceRoot)) {
        await fs.promises.rename(evidenceRoot, rollbackEvidence);
        evidenceMoved = true;
      }
      await fs.promises.mkdir(path.dirname(evidenceRoot), { recursive: true });
      await fs.promises.rename(stagedEvidence, evidenceRoot);
      if (params.failRestoreAfter === 'evidence') throw new Error('Injected restore activation failure after evidence');

      if (fs.existsSync(stagedConfig)) {
        if (fs.existsSync(configPath)) {
          await fs.promises.rename(configPath, rollbackConfig);
          configMoved = true;
        }
        await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
        await fs.promises.rename(stagedConfig, configPath);
        configActivated = true;
      }

      if (sameMachine && manifest.sameMachine?.included) {
        const sameMachineRoot = path.join(params.backupRoot, 'same-machine');
        for (const component of manifest.sameMachine.components || []) {
          const relative = normalizeRelativePath(component.path);
          if (relative.replace(/\\/g, '/') === 'commercial-licence.tglic' && !restoreCommercialLicence) continue;
          const source = ensureContained(sameMachineRoot, path.join(sameMachineRoot, relative));
          const target = ensureContained(userDataRoot, path.join(userDataRoot, relative));
          const componentRollback = ensureContained(rollbackRoot, path.join(rollbackRoot, 'same-machine', relative));
          if (!fs.existsSync(source)) continue;
          const action = { target, rollback: componentRollback, hadExisting: fs.existsSync(target) };
          sameMachineActions.push(action);
          if (fs.existsSync(target)) {
            await fs.promises.mkdir(path.dirname(componentRollback), { recursive: true });
            await fs.promises.rename(target, componentRollback);
          }
          await fs.promises.mkdir(path.dirname(target), { recursive: true });
          await fs.promises.cp(source, target, { recursive: true, errorOnExist: true, force: false });
        }
      }
      integrityCheck(databasePath, params);
      writeFileAtomic(path.join(rollbackRoot, 'rollback-manifest.json'), JSON.stringify({
        createdAt: new Date().toISOString(),
        database: databaseMoved ? rollbackDatabase : null,
        evidence: evidenceMoved ? rollbackEvidence : null,
        configuration: configMoved ? rollbackConfig : null,
      }, null, 2));
      return { restored: true, sameMachine, requiresWhatsAppRelink: !sameMachine, requiresLicenceRecovery, rollbackPath: rollbackRoot };
    } catch (error) {
      for (const action of sameMachineActions.reverse()) {
        await fs.promises.rm(action.target, { recursive: true, force: true }).catch(() => undefined);
        if (action.hadExisting && fs.existsSync(action.rollback)) {
          await fs.promises.mkdir(path.dirname(action.target), { recursive: true });
          await fs.promises.rename(action.rollback, action.target);
        }
      }
      await fs.promises.rm(databasePath, { force: true }).catch(() => undefined);
      if (databaseMoved && fs.existsSync(rollbackDatabase)) await fs.promises.rename(rollbackDatabase, databasePath);
      await fs.promises.rm(evidenceRoot, { recursive: true, force: true }).catch(() => undefined);
      if (evidenceMoved && fs.existsSync(rollbackEvidence)) await fs.promises.rename(rollbackEvidence, evidenceRoot);
      if (configActivated) await fs.promises.rm(configPath, { force: true }).catch(() => undefined);
      if (configMoved && fs.existsSync(rollbackConfig)) await fs.promises.rename(rollbackConfig, configPath);
      throw error;
    }
  } catch (error) {
    throw normalizeDurabilityStorageError(error);
  } finally {
    await fs.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.promises.rm(stagedDatabase, { force: true }).catch(() => undefined);
    await fs.promises.rm(stagedEvidence, { recursive: true, force: true }).catch(() => undefined);
  }
}

module.exports = {
  BACKUP_FORMAT_VERSION,
  BASELINE_MIGRATION_ID,
  CURRENT_SQLITE_SCHEMA_VERSION,
  DURABILITY_MIGRATION_ID,
  SQLITE_MIGRATIONS,
  assertFreeSpace,
  createPatrolSafeBackup,
  createPreUpgradeBackup,
  ensureContained,
  evidenceAggregateHash,
  getMachineBindingHash,
  integrityCheck,
  normalizeRelativePath,
  prepareSqliteDatabase,
  restorePatrolSafeBackup,
  verifyDatabaseEvidenceReferences,
  verifyPatrolSafeBackup,
};
