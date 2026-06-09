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
    const configPath = '/tmp/patrol-setup-config-test.json';
    const { writeFileSync, mkdirSync } = require('fs');
    const { dirname } = require('path');

    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ setupCompleted: 'true' }), 'utf8');

    const loaded = loadDesktopWorkspaceConfig(configPath);
    expect(loaded.setupCompleted).toBe(true);
  });
});
