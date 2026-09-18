const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const durabilityModulePath = process.env.PATROLSAFE_DURABILITY_MODULE
  ? path.resolve(process.env.PATROLSAFE_DURABILITY_MODULE)
  : path.resolve(__dirname, '..', 'desktop', 'data-durability.js');
const appRoot = path.resolve(path.dirname(durabilityModulePath), '..');
const Database = require(path.join(appRoot, 'node_modules', 'better-sqlite3'));
const sharp = require(path.join(appRoot, 'node_modules', 'sharp'));
const durability = require(durabilityModulePath);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function createOldSchemaDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  durability.SQLITE_MIGRATIONS[0].apply(database);
  database.exec(`
    DROP INDEX IF EXISTS "UQ_patrol_images_whatsapp_identity";
    DROP INDEX IF EXISTS "UQ_patrol_groups_active_linked_external";
    DROP INDEX IF EXISTS "IDX_patrol_groups_linkedAccountId";
    ALTER TABLE "sites" DROP COLUMN "archivedAt";
    ALTER TABLE "patrol_groups" DROP COLUMN "linkedAccountId";
    ALTER TABLE "patrol_groups" DROP COLUMN "sourceType";
    ALTER TABLE "patrol_schedules" DROP COLUMN "is24Hours";
    ALTER TABLE "patrol_schedules" DROP COLUMN "expectedGuards";
    ALTER TABLE "patrol_schedules" DROP COLUMN "scheduleName";
    ALTER TABLE "patrol_images" DROP COLUMN "integrityStatus";
    ALTER TABLE "patrol_images" DROP COLUMN "contentSha256";
    ALTER TABLE "patrol_images" DROP COLUMN "linkedAccountId";
    ALTER TABLE "patrol_images" DROP COLUMN "senderExternalId";
  `);
  database.exec(`CREATE TABLE "patrol_schema_migrations" ("id" varchar(160) PRIMARY KEY NOT NULL, "version" integer NOT NULL, "appliedAt" datetime NOT NULL DEFAULT (datetime('now')))`);
  database.prepare('INSERT INTO "patrol_schema_migrations" ("id", "version") VALUES (?, ?)').run(durability.BASELINE_MIGRATION_ID, 1);
  database.close();
}

function prepare(databasePath, root, extra = {}) {
  return durability.prepareSqliteDatabase({
    databasePath,
    preUpgradeBackupRoot: path.join(root, 'pre-upgrade'),
    appVersion: '1.0.0',
    buildId: 'phase-10f-drill',
    ...extra,
  });
}

function databaseCount(databasePath, table) {
  const database = new Database(databasePath, { readonly: true });
  try {
    return Number(database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count);
  } finally {
    database.close();
  }
}

function insertCompany(databasePath, id = 'company-1') {
  const database = new Database(databasePath);
  database.prepare('INSERT INTO "companies" ("id", "companyName") VALUES (?, ?)').run(id, `Company ${id}`);
  database.close();
}

function createFixture(root) {
  const userDataRoot = path.join(root, 'user-data');
  const databasePath = path.join(userDataRoot, 'data', 'patrol-evidence.db');
  const evidenceRoot = path.join(root, 'managed-evidence');
  const configPath = path.join(userDataRoot, 'workspace-config.json');
  prepare(databasePath, root);
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const database = new Database(databasePath);
  database.prepare('INSERT INTO "companies" ("id", "companyName") VALUES (?, ?)').run('company-1', 'Synthetic Security');
  database.prepare('INSERT INTO "users" ("id", "email", "passwordHash", "firstName", "lastName", "role", "companyId") VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('user-1', 'admin@example.invalid', 'synthetic-hash', 'Release', 'Admin', 'COMPANY_ADMIN', 'company-1');
  for (const site of [
    ['site-a', 'SITE-A', 'Synthetic Site A'],
    ['site-b', 'SITE-B', 'Synthetic Site B'],
  ]) {
    database.prepare('INSERT INTO "sites" ("id", "companyId", "siteCode", "siteName") VALUES (?, ?, ?, ?)')
      .run(site[0], 'company-1', site[1], site[2]);
  }
  for (const group of [
    ['group-a', 'site-a', 'Synthetic Group A', '100000000000001@g.us'],
    ['group-b', 'site-b', 'Synthetic Group B', '100000000000002@g.us'],
  ]) {
    database.prepare('INSERT INTO "patrol_groups" ("id", "siteId", "groupName", "externalGroupId", "linkedAccountId") VALUES (?, ?, ?, ?, ?)')
      .run(group[0], group[1], group[2], group[3], 'account-synthetic');
  }
  const pngBase = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  for (let index = 0; index < 3; index += 1) {
    const siteCode = index === 2 ? 'SITE-B' : 'SITE-A';
    const siteId = index === 2 ? 'site-b' : 'site-a';
    const groupId = index === 2 ? 'group-b' : 'group-a';
    const relative = path.join(siteCode, '2026-09-11', '1200', `evidence-${index}.png`);
    const filePath = path.join(evidenceRoot, relative);
    const bytes = Buffer.concat([pngBase, Buffer.from([index])]);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
    database.prepare(`INSERT INTO "patrol_images" (
      "id", "siteId", "groupId", "collectorType", "messageExternalId", "linkedAccountId",
      "sentAt", "receivedAt", "patrolDate", "patrolHour", "storedFileName", "filePath",
      "fileSize", "mimeType", "contentSha256", "integrityStatus", "status"
    ) VALUES (?, ?, ?, 'WHATSAPP', ?, 'account-synthetic', ?, ?, '2026-09-11', 12, ?, ?, ?, 'image/png', ?, 'FINALIZED', 'RECEIVED')`)
      .run(`evidence-${index}`, siteId, groupId, `message-${index}`, '2026-09-11T12:00:00.000Z', '2026-09-11T12:00:01.000Z', path.basename(filePath), filePath, bytes.length, sha256(bytes));
  }
  database.close();
  fs.writeFileSync(configPath, JSON.stringify({ setupCompleted: true, appTimeZone: 'Asia/Dubai', autoStartCollector: true, linkedWhatsAppAccountId: 'account-synthetic', storageRootPath: evidenceRoot, sqliteDbPath: databasePath }));
  fs.mkdirSync(path.join(userDataRoot, 'data', 'whatsapp-session'), { recursive: true });
  fs.writeFileSync(path.join(userDataRoot, 'data', 'whatsapp-session', 'session.marker'), 'same-machine-session');
  fs.mkdirSync(path.join(userDataRoot, 'secure-session'), { recursive: true });
  fs.writeFileSync(path.join(userDataRoot, 'secure-session', 'desktop-auth-session.secure'), 'synthetic-encrypted-session');
  fs.writeFileSync(path.join(userDataRoot, 'license-store.json'), '{"synthetic":true}');
  return { userDataRoot, databasePath, evidenceRoot, configPath };
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patrolsafe-phase10f-'));
  const results = {};
  try {
    const freshDb = path.join(root, 'fresh', 'data.db');
    const fresh = prepare(freshDb, path.join(root, 'fresh'));
    results.freshDatabase = fresh.schemaVersion === durability.CURRENT_SQLITE_SCHEMA_VERSION && databaseCount(freshDb, 'patrol_images') === 0;
    const repeated = prepare(freshDb, path.join(root, 'fresh'));
    results.repeatedStartup = repeated.applied.length === 0 && repeated.preUpgradeBackup === null;
    const { DataSource } = require(path.join(appRoot, 'node_modules', 'typeorm'));
    const { databaseConfig } = require(path.join(appRoot, 'dist', 'config', 'database.config'));
    const schemaDataSource = new DataSource({ ...databaseConfig(), database: freshDb });
    await schemaDataSource.initialize();
    const schemaLog = await schemaDataSource.driver.createSchemaBuilder().log();
    const expectedApplicationIndexes = new Set([
      'DROP INDEX "UQ_patrol_groups_active_linked_external"',
      'DROP INDEX "IDX_patrol_groups_linkedAccountId"',
    ]);
    results.typeormSchemaCompatible = schemaLog.upQueries.every((query) => expectedApplicationIndexes.has(query.query));
    if (!results.typeormSchemaCompatible) {
      results.typeormSchemaDifferences = schemaLog.upQueries.map((query) => query.query);
    }
    await schemaDataSource.destroy();

    insertCompany(freshDb, 'adopted-company');
    const adoptionDatabase = new Database(freshDb);
    adoptionDatabase.exec('DROP TABLE "patrol_schema_migrations"');
    adoptionDatabase.close();
    const adopted = prepare(freshDb, path.join(root, 'fresh'));
    results.existingSchemaAdoption = adopted.adopted && databaseCount(freshDb, 'companies') === 1 && fs.existsSync(adopted.preUpgradeBackup.databaseBackupPath);

    const oldRoot = path.join(root, 'old');
    const oldDb = path.join(oldRoot, 'data.db');
    createOldSchemaDatabase(oldDb);
    insertCompany(oldDb, 'legacy-company');
    const upgraded = prepare(oldDb, oldRoot);
    const upgradedDatabase = new Database(oldDb, { readonly: true });
    const upgradedColumns = upgradedDatabase.pragma('table_info("patrol_images")').map((entry) => entry.name);
    upgradedDatabase.close();
    results.sequentialUpgrade = upgraded.applied.includes(durability.DURABILITY_MIGRATION_ID) && upgradedColumns.includes('contentSha256') && databaseCount(oldDb, 'companies') === 1;
    results.preUpgradeBackup = fs.existsSync(upgraded.preUpgradeBackup.databaseBackupPath) && durability.integrityCheck(upgraded.preUpgradeBackup.databaseBackupPath).ok;

    const failedRoot = path.join(root, 'failed');
    const failedDb = path.join(failedRoot, 'data.db');
    createOldSchemaDatabase(failedDb);
    insertCompany(failedDb, 'failure-company');
    let migrationFailure;
    try {
      prepare(failedDb, failedRoot, { failMigrationId: durability.DURABILITY_MIGRATION_ID });
    } catch (error) {
      migrationFailure = error;
    }
    results.migrationFailure = migrationFailure?.code === 'PATROLSAFE_MIGRATION_FAILED' && fs.existsSync(migrationFailure.preUpgradeBackup) && databaseCount(failedDb, 'companies') === 1;

    const conflictRoot = path.join(root, 'mapping-conflict');
    const conflictDb = path.join(conflictRoot, 'data.db');
    createOldSchemaDatabase(conflictDb);
    const conflictDatabase = new Database(conflictDb);
    conflictDatabase.prepare('INSERT INTO "companies" ("id", "companyName") VALUES (?, ?)').run('conflict-company', 'Conflict Company');
    conflictDatabase.prepare('INSERT INTO "sites" ("id", "companyId", "siteCode", "siteName") VALUES (?, ?, ?, ?)').run('conflict-site-a', 'conflict-company', 'CON-A', 'Conflict A');
    conflictDatabase.prepare('INSERT INTO "sites" ("id", "companyId", "siteCode", "siteName") VALUES (?, ?, ?, ?)').run('conflict-site-b', 'conflict-company', 'CON-B', 'Conflict B');
    conflictDatabase.exec('ALTER TABLE "patrol_groups" ADD COLUMN "linkedAccountId" varchar(120)');
    conflictDatabase.prepare('INSERT INTO "patrol_groups" ("id", "siteId", "groupName", "externalGroupId", "linkedAccountId") VALUES (?, ?, ?, ?, ?)').run('conflict-group-a', 'conflict-site-a', 'Conflict Group A', 'duplicate@g.us', 'account-conflict');
    conflictDatabase.prepare('INSERT INTO "patrol_groups" ("id", "siteId", "groupName", "externalGroupId", "linkedAccountId") VALUES (?, ?, ?, ?, ?)').run('conflict-group-b', 'conflict-site-b', 'Conflict Group B', 'duplicate@g.us', 'account-conflict');
    conflictDatabase.close();
    const conflictUpgrade = prepare(conflictDb, conflictRoot);
    const conflictResultDatabase = new Database(conflictDb, { readonly: true });
    const activeConflicts = Number(conflictResultDatabase.prepare('SELECT COUNT(*) AS count FROM "patrol_groups" WHERE "active" = 1').get().count);
    const preservedConflicts = Number(conflictResultDatabase.prepare('SELECT COUNT(*) AS count FROM "patrol_migration_conflicts"').get().count);
    conflictResultDatabase.close();
    results.legacyMappingConflictQuarantined = conflictUpgrade.mappingConflictsPaused === 2 && activeConflicts === 0 && preservedConflicts === 2 && fs.existsSync(conflictUpgrade.preUpgradeBackup.databaseBackupPath) && databaseCount(conflictDb, 'patrol_groups') === 2;
    const conflictRepeat = prepare(conflictDb, conflictRoot);
    results.historicalMappingConflictDoesNotRetriggerMigrationNotice =
      conflictRepeat.applied.length === 0 &&
      conflictRepeat.mappingConflictsPaused === 0 &&
      conflictRepeat.mappingConflictsUnresolved === 2;

    const corruptDb = path.join(root, 'corrupt', 'data.db');
    fs.mkdirSync(path.dirname(corruptDb), { recursive: true });
    fs.writeFileSync(corruptDb, 'not-a-sqlite-database');
    try {
      prepare(corruptDb, path.join(root, 'corrupt'));
      results.corruptDatabase = false;
    } catch (error) {
      results.corruptDatabase = error.code === 'PATROLSAFE_DATABASE_CORRUPT' && fs.readFileSync(corruptDb, 'utf8') === 'not-a-sqlite-database';
    }

    const fixture = createFixture(path.join(root, 'fixture'));
    const backup = await durability.createPatrolSafeBackup({
      ...fixture,
      destinationParent: path.join(root, 'backups'),
      appVersion: '1.0.0',
      buildId: 'phase-10f-drill',
      machineBindingHash: 'machine-a',
    });
    const verified = await durability.verifyPatrolSafeBackup(backup.backupPath);
    results.backupManifest = verified.manifest.evidence.rowCount === 3 && verified.manifest.evidence.fileCount === 3 && verified.manifest.configuration.sha256.length === 64;
    results.backupIntegrity = verified.manifest.database.sha256.length === 64 && verified.manifest.evidence.referencedFileCount === 3;
    results.desktopSessionExcluded = !fs.existsSync(path.join(backup.backupPath, 'same-machine', 'secure-session', 'desktop-auth-session.secure'));
    const originalStatfs = fs.promises.statfs;
    try {
      fs.promises.statfs = async () => ({ bavail: 0, bsize: 4096 });
      await durability.assertFreeSpace(root, 1);
      results.backupDiskFull = false;
    } catch (error) {
      results.backupDiskFull = error.code === 'PATROLSAFE_INSUFFICIENT_SPACE';
    } finally {
      fs.promises.statfs = originalStatfs;
    }

    fs.rmSync(fixture.evidenceRoot, { recursive: true, force: true });
    fs.mkdirSync(fixture.evidenceRoot, { recursive: true });
    fs.writeFileSync(path.join(fixture.evidenceRoot, 'changed.txt'), 'changed');
    const mutated = new Database(fixture.databasePath);
    mutated.exec('DELETE FROM "patrol_images"; DELETE FROM "patrol_groups";');
    mutated.close();
    fs.writeFileSync(fixture.configPath, JSON.stringify({ autoStartCollector: false }));
    fs.writeFileSync(path.join(fixture.userDataRoot, 'data', 'whatsapp-session', 'session.marker'), 'changed-session');
    const restored = await durability.restorePatrolSafeBackup({ ...fixture, backupRoot: backup.backupPath, machineBindingHash: 'machine-a' });
    const restoredConfig = JSON.parse(fs.readFileSync(fixture.configPath, 'utf8'));
    results.sameMachineRestore = restored.sameMachine && !restored.requiresWhatsAppRelink && databaseCount(fixture.databasePath, 'patrol_images') === 3 && restoredConfig.autoStartCollector === true;
    results.monitoringPreferencePreserved = restoredConfig.autoStartCollector === true;
    results.workspaceTimeZonePreserved = restoredConfig.appTimeZone === 'Asia/Dubai';
    results.sameMachineLocalAuth = fs.readFileSync(path.join(fixture.userDataRoot, 'data', 'whatsapp-session', 'session.marker'), 'utf8') === 'same-machine-session';
    results.sameMachineLicenceState = fs.readFileSync(path.join(fixture.userDataRoot, 'license-store.json'), 'utf8') === '{"synthetic":true}';
    results.mappingEvidencePreserved = databaseCount(fixture.databasePath, 'sites') === 2 && databaseCount(fixture.databasePath, 'patrol_groups') === 2 && databaseCount(fixture.databasePath, 'patrol_images') === 3;
    const restoredDatabase = new Database(fixture.databasePath, { readonly: true });
    const restoredEvidence = restoredDatabase.prepare('SELECT "filePath", "fileSize", "contentSha256" FROM "patrol_images" ORDER BY "id"').all();
    restoredDatabase.close();
    let restoredEvidenceValid = true;
    for (const evidence of restoredEvidence) {
      const bytes = fs.readFileSync(evidence.filePath);
      await sharp(bytes).metadata();
      restoredEvidenceValid &&= bytes.length === Number(evidence.fileSize) && sha256(bytes) === evidence.contentSha256;
    }
    results.restoredEvidenceIntegrity = restoredEvidenceValid;

    fs.writeFileSync(fixture.configPath, JSON.stringify({ marker: 'current-before-failed-restore' }));
    fs.writeFileSync(path.join(fixture.evidenceRoot, 'current-marker.txt'), 'current');
    let restoreFailed = false;
    try {
      await durability.restorePatrolSafeBackup({ ...fixture, backupRoot: backup.backupPath, machineBindingHash: 'machine-a', failRestoreAfter: 'evidence' });
    } catch {
      restoreFailed = true;
    }
    results.restoreAtomicity = restoreFailed && JSON.parse(fs.readFileSync(fixture.configPath, 'utf8')).marker === 'current-before-failed-restore' && fs.readFileSync(path.join(fixture.evidenceRoot, 'current-marker.txt'), 'utf8') === 'current';

    const tampered = path.join(root, 'tampered');
    fs.cpSync(backup.backupPath, tampered, { recursive: true });
    const firstEvidence = verified.manifest.evidence.files[0].path.split('/').join(path.sep);
    fs.appendFileSync(path.join(tampered, 'evidence', firstEvidence), 'tampered');
    try {
      await durability.verifyPatrolSafeBackup(tampered);
      results.tamperedBackup = false;
    } catch {
      results.tamperedBackup = true;
    }

    const traversal = path.join(root, 'traversal');
    fs.cpSync(backup.backupPath, traversal, { recursive: true });
    const traversalManifestPath = path.join(traversal, 'manifest.json');
    const traversalManifest = JSON.parse(fs.readFileSync(traversalManifestPath, 'utf8'));
    traversalManifest.evidence.files[0].path = '../outside.png';
    fs.writeFileSync(traversalManifestPath, JSON.stringify(traversalManifest));
    try {
      await durability.verifyPatrolSafeBackup(traversal);
      results.pathTraversal = false;
    } catch {
      results.pathTraversal = true;
    }

    const unsupportedComponent = path.join(root, 'unsupported-component');
    fs.cpSync(backup.backupPath, unsupportedComponent, { recursive: true });
    const unsupportedManifestPath = path.join(unsupportedComponent, 'manifest.json');
    const unsupportedManifest = JSON.parse(fs.readFileSync(unsupportedManifestPath, 'utf8'));
    unsupportedManifest.sameMachine.components[0].path = 'secure-session/desktop-auth-session.secure';
    fs.writeFileSync(unsupportedManifestPath, JSON.stringify(unsupportedManifest));
    try {
      await durability.verifyPatrolSafeBackup(unsupportedComponent);
      results.unsupportedSameMachineComponent = false;
    } catch {
      results.unsupportedSameMachineComponent = true;
    }

    const replacement = {
      userDataRoot: path.join(root, 'replacement', 'user-data'),
      databasePath: path.join(root, 'replacement', 'user-data', 'data', 'patrol-evidence.db'),
      evidenceRoot: path.join(root, 'replacement', 'evidence'),
      configPath: path.join(root, 'replacement', 'user-data', 'workspace-config.json'),
    };
    fs.mkdirSync(replacement.userDataRoot, { recursive: true });
    const replacementResult = await durability.restorePatrolSafeBackup({ ...replacement, backupRoot: backup.backupPath, machineBindingHash: 'machine-b' });
    const replacementConfig = JSON.parse(fs.readFileSync(replacement.configPath, 'utf8'));
    results.replacementMachine = replacementResult.requiresWhatsAppRelink && replacementConfig.autoStartCollector === false && replacementConfig.appTimeZone === 'Asia/Dubai' && !fs.existsSync(path.join(replacement.userDataRoot, 'data', 'whatsapp-session')) && databaseCount(replacement.databasePath, 'patrol_images') === 3;

    if (process.env.PATROLSAFE_ADOPTION_SOURCE) {
      const adoptionCopy = path.join(root, 'preserved-certified-copy.db');
      fs.copyFileSync(path.resolve(process.env.PATROLSAFE_ADOPTION_SOURCE), adoptionCopy);
      const before = ['companies', 'users', 'sites', 'patrol_groups', 'patrol_images']
        .map((table) => databaseCount(adoptionCopy, table));
      try {
        const adoptionResult = prepare(adoptionCopy, path.join(root, 'preserved-adoption'));
        const after = ['companies', 'users', 'sites', 'patrol_groups', 'patrol_images']
          .map((table) => databaseCount(adoptionCopy, table));
        results.preservedCertifiedDatabaseDisposition = {
          status: 'ADOPTED',
          preserved: adoptionResult.schemaVersion === durability.CURRENT_SQLITE_SCHEMA_VERSION && before.every((count, index) => count === after[index]),
          mappingConflictsPaused: adoptionResult.mappingConflictsPaused,
        };
      } catch (error) {
        const after = ['companies', 'users', 'sites', 'patrol_groups', 'patrol_images']
          .map((table) => databaseCount(adoptionCopy, table));
        results.preservedCertifiedDatabaseDisposition = {
          status: 'BLOCKED_OTHER',
          preserved: before.every((count, index) => count === after[index]),
          preUpgradeBackup: Boolean(error.preUpgradeBackup && fs.existsSync(error.preUpgradeBackup)),
        };
      }
    }

    assert(Object.values(results).every(Boolean), JSON.stringify(results));
    console.log(JSON.stringify(results));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
