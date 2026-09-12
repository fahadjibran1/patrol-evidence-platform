import { readFileSync } from 'fs';
import { join } from 'path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function functionBody(contents: string, name: string, nextName: string): string {
  const start = contents.indexOf(`async function ${name}`);
  const end = nextName ? contents.indexOf(`async function ${nextName}`, start + 1) : contents.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return contents.slice(start, end);
}

describe('packaged first-run initialization contract', () => {
  const setupPage = source('web/src/pages/desktop-setup-page.tsx');
  const desktopMain = source('desktop/main.js');
  const desktopService = source('src/desktop/desktop.service.ts');

  it('persists company and admin before any restart-capable desktop config call', () => {
    const body = functionBody(setupPage, 'submitCompanyStep', 'continueToSiteSetup');
    const initialize = body.indexOf("'/desktop/bootstrap/initialize'");
    const desktopConfig = body.indexOf('saveDesktopConfig(');
    expect(initialize).toBeGreaterThanOrEqual(0);
    expect(desktopConfig).toBeGreaterThan(initialize);
    expect(body).not.toContain('restartDesktopBackend(');
    expect(body).not.toContain('persistWorkspaceSettings(');
  });

  it('records durable wizard progress before a storage change may restart the packaged backend', () => {
    const body = functionBody(setupPage, 'continueToWhatsAppStep', 'saveStorageStep');
    expect(body).toContain("{ storageRootPath: selectedPath, setupStage: 'whatsapp' }");
    expect(setupPage).toContain('nextBootstrapStatus.setupStage');
    expect(desktopMain).toContain("setupStage: 'company'");
  });

  it('writes setup completion before routing away from first-run setup', () => {
    const body = functionBody(setupPage, 'finishSetup', '');
    const complete = body.indexOf("'/desktop/bootstrap/complete-setup'");
    const save = body.indexOf("saveDesktopConfig({ setupCompleted: true, setupStage: 'complete' })");
    const navigate = body.indexOf("navigate('/')");
    expect(complete).toBeGreaterThanOrEqual(0);
    expect(save).toBeGreaterThan(complete);
    expect(navigate).toBeGreaterThan(save);
    expect(desktopService).toContain("setupStage: 'complete'");
  });

  it('passes one authoritative config path and database path to every backend child', () => {
    expect(desktopMain).toContain('const desktopConfigPath = getConfigPath();');
    expect(desktopMain).toContain('DESKTOP_CONFIG_PATH: desktopConfigPath');
    expect(desktopMain).toContain('SQLITE_DB_PATH: runtimeValues.sqliteDbPath');
    expect(desktopMain).toContain('env: packagedBackendEnv');
  });

  it('does not let schema preparation overwrite setup state', () => {
    expect(desktopMain).toMatch(/const currentConfig = readWorkspaceConfig\(\);[\s\S]*const syncedConfig = \{[\s\S]*\.\.\.currentConfig,[\s\S]*sqliteDbPath/);
    expect(desktopMain).toContain('writeWorkspaceConfigAtomic(desktopConfigPath, syncedConfig)');
  });

  it('keeps initialized bootstrap mutation protected', () => {
    const controller = source('src/desktop/desktop.controller.ts');
    expect(controller).toMatch(/@Post\('initialize'\)\s*@UseGuards\(DesktopInitializedMutationGuard\)/);
    expect(controller).toMatch(/@Post\('complete-setup'\)\s*@UseGuards\(JwtAuthGuard\)/);
  });

  it('does not delete customer data during Squirrel uninstall', () => {
    const uninstall = desktopMain.slice(
      desktopMain.indexOf("case '--squirrel-uninstall':"),
      desktopMain.indexOf("case '--squirrel-obsolete':"),
    );
    expect(uninstall).toContain('--removeShortcut');
    expect(uninstall).not.toMatch(/rmSync|unlinkSync|rmdirSync|userData/);
  });
});
