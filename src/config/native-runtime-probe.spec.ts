// eslint-disable-next-line @typescript-eslint/no-require-imports
const { probeBetterSqlite3Load } = require('../../scripts/native-runtime.util') as {
  probeBetterSqlite3Load(runtime: 'electron' | 'node'): { ok: boolean; error: Error | null };
};

describe('desktop SQLite native compatibility probe', () => {
  it('opens, queries, and closes an in-memory database under Electron', () => {
    const result = probeBetterSqlite3Load('electron');

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });
});
