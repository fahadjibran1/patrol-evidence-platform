import { loadDesktopWorkspaceConfig, normalizeSetupCompleted } from './desktop-config.util';

describe('desktop-config.util', () => {
  it('normalizes setupCompleted from boolean and string values', () => {
    expect(normalizeSetupCompleted(true)).toBe(true);
    expect(normalizeSetupCompleted('true')).toBe(true);
    expect(normalizeSetupCompleted(false)).toBe(false);
    expect(normalizeSetupCompleted('false')).toBe(false);
    expect(normalizeSetupCompleted(undefined)).toBe(false);
  });

  it('normalizes setupCompleted when loading workspace config from disk', () => {
    const { mkdtempSync, writeFileSync, rmSync } = require('fs');
    const { join } = require('path');
    const { tmpdir } = require('os');

    const tempDirectory = mkdtempSync(join(tmpdir(), 'patrol-setup-config-'));
    const configPath = join(tempDirectory, 'workspace.json');
    try {
      writeFileSync(configPath, JSON.stringify({ setupCompleted: 'true' }), 'utf8');

      const loaded = loadDesktopWorkspaceConfig(configPath);
      expect(loaded.setupCompleted).toBe(true);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
