import { spawnSync } from 'child_process';
import * as path from 'path';

type DrillResult = Record<string, boolean>;

describe('PatrolSafe SQLite migration and backup recovery', () => {
  let result: DrillResult;

  beforeAll(() => {
    const electronExecutable = require('electron') as string;
    const drill = spawnSync(electronExecutable, [path.resolve('scripts', 'data-durability-drill.js')], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DB_TYPE: 'sqlite' },
    });
    if (drill.status !== 0) {
      throw new Error(drill.stderr || drill.stdout || 'Data durability drill failed');
    }
    result = JSON.parse(drill.stdout.trim()) as DrillResult;
  }, 30_000);

  it('creates a complete schema from a new database', () => expect(result.freshDatabase).toBe(true));
  it('matches current TypeORM entity structure while retaining application-owned indexes', () => {
    expect(result.typeormSchemaCompatible).toBe(true);
  });
  it('adopts an existing current schema without data loss', () => expect(result.existingSchemaAdoption).toBe(true));
  it('upgrades an older schema sequentially', () => expect(result.sequentialUpgrade).toBe(true));
  it('does not rerun completed migrations', () => expect(result.repeatedStartup).toBe(true));
  it('retains a verified pre-upgrade SQLite backup', () => expect(result.preUpgradeBackup).toBe(true));
  it('fails a migration closed while preserving its recovery backup', () => expect(result.migrationFailure).toBe(true));
  it('preserves but pauses ambiguous legacy mappings before installing uniqueness', () => {
    expect(result.legacyMappingConflictQuarantined).toBe(true);
  });
  it('does not delete or recreate a corrupt customer database', () => expect(result.corruptDatabase).toBe(true));
  it('writes a versioned and internally consistent backup manifest', () => expect(result.backupManifest).toBe(true));
  it('verifies database and evidence integrity', () => expect(result.backupIntegrity).toBe(true));
  it('excludes the desktop login session from backup data', () => expect(result.desktopSessionExcluded).toBe(true));
  it('fails backup and restore capacity checks with customer-safe storage guidance', () => {
    expect(result.backupDiskFull).toBe(true);
  });
  it('restores database, evidence, mappings, and configuration on the same machine', () => {
    expect(result.sameMachineRestore).toBe(true);
    expect(result.mappingEvidencePreserved).toBe(true);
  });
  it('preserves same-machine LocalAuth state', () => expect(result.sameMachineLocalAuth).toBe(true));
  it('preserves same-machine licence and monitoring state', () => {
    expect(result.sameMachineLicenceState).toBe(true);
    expect(result.monitoringPreferencePreserved).toBe(true);
  });
  it('restores decodable evidence with its original size and SHA-256', () => {
    expect(result.restoredEvidenceIntegrity).toBe(true);
  });
  it('rolls back all activated state when restore is interrupted', () => expect(result.restoreAtomicity).toBe(true));
  it('rejects a tampered backup', () => expect(result.tamperedBackup).toBe(true));
  it('rejects manifest path traversal', () => expect(result.pathTraversal).toBe(true));
  it('rejects unsupported same-machine component targets', () => {
    expect(result.unsupportedSameMachineComponent).toBe(true);
  });
  it('restores durable records but requires relink on a replacement machine', () => {
    expect(result.replacementMachine).toBe(true);
  });
});
