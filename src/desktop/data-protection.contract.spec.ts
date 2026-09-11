import { readFileSync } from 'fs';
import * as path from 'path';

describe('desktop data protection contract', () => {
  const mainSource = readFileSync(path.resolve('desktop', 'main.js'), 'utf8');
  const preloadSource = readFileSync(path.resolve('desktop', 'preload.js'), 'utf8');
  const durabilitySource = readFileSync(path.resolve('desktop', 'data-durability.js'), 'utf8');
  const rendererSource = readFileSync(path.resolve('web', 'src', 'pages', 'collector-diagnostics-page.tsx'), 'utf8');

  it('exposes backup and restore only through trusted Electron IPC', () => {
    expect(mainSource).toContain("handleTrusted('desktop:create-data-backup'");
    expect(mainSource).toContain("handleTrusted('desktop:restore-data-backup'");
    expect(preloadSource).toContain("ipcRenderer.invoke('desktop:create-data-backup')");
    expect(preloadSource).toContain("ipcRenderer.invoke('desktop:restore-data-backup')");
  });

  it('requires administrator verification and native restore confirmation', () => {
    expect(mainSource).toContain('assertDataProtectionAdministrator');
    expect(mainSource).toContain("buttons: ['Cancel', 'Restore backup']");
    expect(mainSource).toContain("buttons: ['Cancel', 'Create backup']");
  });

  it('keeps LocalAuth same-machine-only without changing its compatibility path', () => {
    expect(durabilitySource).toContain("'data/whatsapp-session'");
    expect(durabilitySource).toContain("portability: 'SAME_MACHINE_ONLY'");
    expect(durabilitySource).toContain('requiresWhatsAppRelink: !sameMachine');
  });

  it('provides understandable customer backup and restore actions', () => {
    expect(rendererSource).toContain('Backup PatrolSafe data');
    expect(rendererSource).toContain('Restore PatrolSafe backup');
    expect(rendererSource).toContain('Restoring replaces the current data');
  });

  it('never silently recreates a corrupt database', () => {
    expect(durabilitySource).toContain('PATROLSAFE_DATABASE_CORRUPT');
    expect(mainSource).toContain('It has not been replaced or reset');
  });

  it('keeps uninstall non-destructive to customer AppData', () => {
    const uninstallCase = mainSource.slice(
      mainSource.indexOf("case '--squirrel-uninstall'"),
      mainSource.indexOf("case '--squirrel-obsolete'"),
    );
    expect(uninstallCase).toContain('--removeShortcut');
    expect(uninstallCase).not.toMatch(/rmSync|unlinkSync|rmdirSync|userData/);
  });

  it('excludes regenerable desktop bearer and signing secrets from backups', () => {
    expect(durabilitySource).toContain("'desktop-login-session'");
    expect(durabilitySource).toContain("'jwt-secret'");
    expect(durabilitySource).toContain("'desktop-api-token'");
    expect(durabilitySource).toContain("'desktop-recovery-authority'");
  });
});
