import { readFileSync } from 'fs';
import * as path from 'path';

describe('packaged desktop shutdown ownership contract', () => {
  const desktop = readFileSync(path.resolve('desktop/main.js'), 'utf8');
  const stopChild = readFileSync(path.resolve('desktop/backend-shutdown.js'), 'utf8');
  const backend = readFileSync(path.resolve('src/main.ts'), 'utf8');
  const helper = readFileSync(path.resolve('src/collectors/whatsapp-helper.main.ts'), 'utf8');

  it('requests a graceful close over the exact spawned backend private pipe before forced fallback', () => {
    const packagedSpawn = desktop.slice(desktop.indexOf('const packagedBackendEnv'), desktop.indexOf('} else {\n    const nestCliPath'));
    expect(packagedSpawn).toContain("stdio: ['pipe', 'pipe', 'pipe']");
    const stop = desktop.slice(desktop.indexOf('function stopBackend()'), desktop.indexOf('async function restartBackend()'));
    expect(stop).toContain("require('./backend-shutdown').stopSpawnedBackend(child");
    expect(stop).toContain('forceKillTree: killProcessTree');
    expect(stopChild).toContain('child.stdin.write(`PATROLSAFE_SHUTDOWN ${options.sessionId}\\n`');
    expect(stopChild).toContain('options.forceKillTree?.(child.pid)');
    expect(backend).toContain('installDesktopShutdownControl(');
    expect(backend).toContain('() => app.close()');
  });

  it('closes the managed browser without logout or LocalAuth deletion and reaps only verified owners', () => {
    const shutdown = helper.slice(helper.indexOf('async function shutdown('), helper.indexOf('function wireCommands()'));
    expect(shutdown).toContain("closeBrowserGracefully(currentClient, 'shutdown')");
    expect(shutdown).not.toContain('.logout(');
    expect(shutdown).not.toContain('rmSync(');
    const close = helper.slice(helper.indexOf('async function closeBrowserGracefully('), helper.indexOf('async function releaseStaleBrowserSession()'));
    expect(close).toContain('selectOwnedProfileBrowserProcesses(');
    expect(close).toContain('verifiedProfilePath: profileDir');
    expect(close).toContain('currentClient.destroy()');
  });
});
