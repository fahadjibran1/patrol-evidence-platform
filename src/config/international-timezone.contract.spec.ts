import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appConfig } from './app.config';
import { writeDesktopWorkspaceConfigFile } from '@/desktop/desktop-config.util';
import {
  formatPatrolDateTime,
  getPatrolTimeParts as getRendererPatrolTimeParts,
  setWorkspaceTimeZone,
  workspaceDateTimeInputToUtc,
} from '../../web/src/lib/patrol-time';

const source = (relativePath: string): string => readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('international workspace timezone contract', () => {
  const originalEnv = { ...process.env };
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'patrolsafe-timezone-'));
    delete process.env.BUSINESS_TIMEZONE;
    delete process.env.APP_TIMEZONE;
    process.env.DESKTOP_CONFIG_PATH = join(root, 'workspace-config.json');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(root, { recursive: true, force: true });
  });

  it.each(['Europe/London', 'America/New_York', 'Asia/Dubai', 'Asia/Kolkata', 'Pacific/Auckland'])(
    'uses persisted %s independently of the host timezone',
    (appTimeZone) => {
      process.env.TZ = appTimeZone === 'Asia/Dubai' ? 'America/Los_Angeles' : 'Asia/Dubai';
      writeDesktopWorkspaceConfigFile(process.env.DESKTOP_CONFIG_PATH!, { setupCompleted: true, appTimeZone });
      const config = appConfig();
      expect(config.businessTimeZone).toBe(appTimeZone);
      expect(config.appTimeZone).toBe(appTimeZone);
    },
  );

  it('fails closed for an invalid persisted timezone', () => {
    writeDesktopWorkspaceConfigFile(process.env.DESKTOP_CONFIG_PATH!, {
      setupCompleted: true,
      appTimeZone: 'UTC+04',
    });
    expect(() => appConfig()).toThrow('Choose a valid time zone');
  });

  it('detects first-run workstation timezone and requires customer review in setup', () => {
    const setup = source('web/src/pages/desktop-setup-page.tsx');
    const time = source('web/src/lib/patrol-time.ts');
    expect(time).toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
    expect(setup).toContain('detectWorkstationTimeZone()');
    expect(setup).toContain('Time zone');
    expect(setup).toContain('appTimeZone: setupForm.appTimeZone');
  });

  it('keeps initialized legacy migration separate from new first-run detection', () => {
    const desktop = source('desktop/main.js');
    expect(desktop).toContain('config.setupCompleted !== true');
    expect(desktop).toContain("appTimeZone: 'Europe/London'");
    expect(desktop).toContain('WORKSPACE_TIMEZONE_MIGRATED');
  });

  it('restarts operational services after an authenticated timezone change', () => {
    const desktop = source('desktop/main.js');
    const settings = source('web/src/pages/company-settings-page.tsx');
    expect(desktop).toMatch(/restartKeys\s*=\s*\[[\s\S]*'appTimeZone'/);
    expect(settings).toContain('Historical evidence timestamps stay unchanged');
    expect(settings).toContain('appTimeZone');
  });

  it('preserves UTC evidence identity while rendering in workspace time', () => {
    const entity = source('src/patrol-images/entities/patrol-image.entity.ts');
    const storage = source('src/storage/storage.service.ts');
    expect(entity).toContain('sentAt!: Date');
    expect(entity).toContain('contentSha256');
    expect(storage).toContain('getPatrolTimeParts(params.timestamp, this.businessTimeZone)');
  });

  it.each([
    ['Europe/London', '2026-09-14', 13],
    ['America/New_York', '2026-09-14', 8],
    ['Asia/Dubai', '2026-09-14', 16],
    ['Asia/Kolkata', '2026-09-14', 17],
    ['Pacific/Auckland', '2026-09-15', 0],
  ] as const)('renders the same UTC instant in %s operational time', (timeZone, date, hour) => {
    setWorkspaceTimeZone(timeZone);
    const parts = getRendererPatrolTimeParts(new Date('2026-09-14T12:00:00.000Z'));
    expect(parts.date).toBe(date);
    expect(parts.hour).toBe(hour);
    expect(formatPatrolDateTime('2026-09-14T12:00:00.000Z')).toMatch(/2026/);
  });

  it('converts customer civil input to UTC without using the machine timezone', () => {
    process.env.TZ = 'America/Los_Angeles';
    setWorkspaceTimeZone('Asia/Dubai');
    expect(workspaceDateTimeInputToUtc('2026-09-14T08:30').toISOString()).toBe('2026-09-14T04:30:00.000Z');
  });
});
