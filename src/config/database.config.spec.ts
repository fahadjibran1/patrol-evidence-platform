import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { databaseConfig, resolveDatabaseType, resolveSqliteDatabasePath } from './database.config';

describe('databaseConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DB_TYPE;
    delete process.env.SQLITE_DB_PATH;
    delete process.env.DESKTOP_CONFIG_PATH;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults desktop mode to sqlite', () => {
    process.env.DESKTOP_CONFIG_PATH = path.join(os.tmpdir(), 'patrol-evidence-platform', 'workspace.json');

    expect(resolveDatabaseType()).toBe('sqlite');

    const config = databaseConfig();
    expect(config.type).toBe('better-sqlite3');
    expect(resolveSqliteDatabasePath()).toContain(path.join('data', 'patrol-evidence.db'));
  });

  it('creates the sqlite folder path when sqlite mode is active', () => {
    const sqlitePath = path.join(os.tmpdir(), 'patrol-evidence-platform-db-test', 'data', 'patrol-evidence.db');
    process.env.DB_TYPE = 'sqlite';
    process.env.SQLITE_DB_PATH = sqlitePath;

    const config = databaseConfig();

    expect(config.type).toBe('better-sqlite3');
    expect(existsSync(path.dirname(sqlitePath))).toBe(true);
  });

  it('keeps postgres support when explicitly configured', () => {
    process.env.DB_TYPE = 'postgres';
    process.env.DB_HOST = 'db.internal';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'patrol';
    process.env.DB_PASSWORD = 'secret';
    process.env.DB_NAME = 'patrol_evidence_prod';

    expect(resolveDatabaseType()).toBe('postgres');

    const config = databaseConfig();
    expect(config.type).toBe('postgres');
    if (config.type !== 'postgres') {
      throw new Error('Expected postgres config');
    }

    expect(config.host).toBe('db.internal');
    expect(config.port).toBe(5433);
    expect(config.username).toBe('patrol');
    expect(config.database).toBe('patrol_evidence_prod');
    expect(config.synchronize).toBe(false);
  });
});
