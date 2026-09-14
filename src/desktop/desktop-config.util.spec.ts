import {
  getDefaultDesktopWorkspaceConfig,
  getDesktopConfigPath,
  loadDesktopWorkspaceConfig,
  normalizeDesktopSetupStage,
  normalizeSetupCompleted,
  resolveWorkspaceTimeZone,
  writeDesktopWorkspaceConfigFile,
  writeDesktopWorkspaceConfigPatch,
} from './desktop-config.util';

describe('desktop-config.util', () => {
  it('uses automatic WhatsApp browser selection for an unconfigured workspace', () => {
    expect(getDefaultDesktopWorkspaceConfig().whatsappBrowser).toBe('auto');
  });

  it('keeps the Electron workspace default and restart contract aligned', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const desktopMain = readFileSync(join(process.cwd(), 'desktop', 'main.js'), 'utf8');
    expect(desktopMain).toContain("whatsappBrowser: 'auto'");
    expect(desktopMain).toMatch(/restartKeys\s*=\s*\[[\s\S]*'whatsappBrowser'/);
    expect(desktopMain).toMatch(/restartKeys\s*=\s*\[[\s\S]*'appTimeZone'/);
    expect(desktopMain).toContain("writeWorkspaceConfig({ appTimeZone: 'Europe/London' })");
  });

  it('uses Europe/London only as the compatibility timezone for initialized legacy workspaces', () => {
    expect(resolveWorkspaceTimeZone({ setupCompleted: true })).toBe('Europe/London');
    expect(() => resolveWorkspaceTimeZone({ setupCompleted: false })).toThrow('Choose a valid time zone');
  });

  it('normalizes valid IANA timezones and rejects invalid persisted values', () => {
    expect(resolveWorkspaceTimeZone({ setupCompleted: true, appTimeZone: 'Asia/Kolkata' })).toBe('Asia/Kolkata');
    expect(() => resolveWorkspaceTimeZone({ setupCompleted: true, appTimeZone: 'UTC+5' })).toThrow(
      'Choose a valid time zone',
    );
  });

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
      expect(loaded.setupStage).toBe('complete');
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it('normalizes authoritative first-run stages and fails closed to company', () => {
    expect(normalizeDesktopSetupStage('storage')).toBe('storage');
    expect(normalizeDesktopSetupStage('whatsapp')).toBe('whatsapp');
    expect(normalizeDesktopSetupStage('site-setup')).toBe('site-setup');
    expect(normalizeDesktopSetupStage('complete')).toBe('complete');
    expect(normalizeDesktopSetupStage('unknown')).toBe('company');
    expect(normalizeDesktopSetupStage(undefined)).toBe('company');
  });

  it('atomically persists setup completion and leaves no temporary config artifact', () => {
    const { mkdtempSync, readdirSync, rmSync } = require('fs');
    const { join } = require('path');
    const { tmpdir } = require('os');

    const tempDirectory = mkdtempSync(join(tmpdir(), 'patrol-setup-atomic-'));
    const configPath = join(tempDirectory, 'workspace config.json');
    try {
      writeDesktopWorkspaceConfigFile(configPath, {
        setupCompleted: true,
        setupStage: 'complete',
        companyName: 'PatrolSafe UAT Ltd',
      });

      expect(loadDesktopWorkspaceConfig(configPath)).toMatchObject({
        setupCompleted: true,
        setupStage: 'complete',
        companyName: 'PatrolSafe UAT Ltd',
      });
      expect(readdirSync(tempDirectory)).toEqual(['workspace config.json']);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it('leaves the previous authoritative config intact when serialization fails', () => {
    const { mkdtempSync, readdirSync, rmSync } = require('fs');
    const { join } = require('path');
    const { tmpdir } = require('os');
    const tempDirectory = mkdtempSync(join(tmpdir(), 'patrol-setup-fail-closed-'));
    const configPath = join(tempDirectory, 'workspace-config.json');
    try {
      writeDesktopWorkspaceConfigFile(configPath, { setupCompleted: false, setupStage: 'storage' });
      expect(() =>
        writeDesktopWorkspaceConfigFile(configPath, {
          setupCompleted: true,
          setupStage: 'complete',
          companyName: 1n as unknown as string,
        }),
      ).toThrow();
      expect(loadDesktopWorkspaceConfig(configPath)).toMatchObject({
        setupCompleted: false,
        setupStage: 'storage',
      });
      expect(readdirSync(tempDirectory)).toEqual(['workspace-config.json']);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it('uses the same absolute config path across simulated process generations', () => {
    const original = process.env.DESKTOP_CONFIG_PATH;
    const configPath = 'C:\\Users\\PatrolUat\\AppData\\Roaming\\Patrol Evidence Platform\\workspace-config.json';
    try {
      process.env.DESKTOP_CONFIG_PATH = configPath;
      expect(getDesktopConfigPath()).toBe(configPath);
      expect(getDesktopConfigPath()).toBe(configPath);
    } finally {
      if (original === undefined) delete process.env.DESKTOP_CONFIG_PATH;
      else process.env.DESKTOP_CONFIG_PATH = original;
    }
  });

  it('preserves trial and workspace state while advancing setup across generations', () => {
    const { mkdtempSync, rmSync } = require('fs');
    const { join } = require('path');
    const { tmpdir } = require('os');
    const original = process.env.DESKTOP_CONFIG_PATH;
    const tempDirectory = mkdtempSync(join(tmpdir(), 'patrol-setup-generation-'));
    const configPath = join(tempDirectory, 'workspace-config.json');
    try {
      process.env.DESKTOP_CONFIG_PATH = configPath;
      writeDesktopWorkspaceConfigPatch({
        setupCompleted: false,
        setupStage: 'storage',
        companyName: 'PatrolSafe UAT Ltd',
        trialStartDate: '2026-09-12T00:00:00.000Z',
        trialEndDate: '2026-10-12T00:00:00.000Z',
      });
      writeDesktopWorkspaceConfigPatch({ setupStage: 'whatsapp' });
      writeDesktopWorkspaceConfigPatch({ setupCompleted: true, setupStage: 'complete' });

      expect(loadDesktopWorkspaceConfig(configPath)).toMatchObject({
        setupCompleted: true,
        setupStage: 'complete',
        companyName: 'PatrolSafe UAT Ltd',
        trialStartDate: '2026-09-12T00:00:00.000Z',
        trialEndDate: '2026-10-12T00:00:00.000Z',
      });
    } finally {
      if (original === undefined) delete process.env.DESKTOP_CONFIG_PATH;
      else process.env.DESKTOP_CONFIG_PATH = original;
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
