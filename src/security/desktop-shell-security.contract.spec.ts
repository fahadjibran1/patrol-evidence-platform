import { readFileSync, rmSync } from 'fs';
import { join } from 'path';

const policy = require('../../desktop/security-policy') as {
  assertTrustedIpcSender: (event: unknown, window: unknown) => void;
  productionDevToolsAllowed: (input: { packaged: boolean; appDebug: boolean; supportMode: boolean }) => boolean;
  isTrustedRendererNavigation: (value: string, input: { packagedEntryUrl: string; developmentUrl: string }) => boolean;
  validateExternalUrl: (value: string) => string;
  validateOpenPath: (value: string, roots: string[]) => string;
};

describe('Electron trust boundary contract', () => {
  it('rejects IPC from any renderer other than the main trusted frame', () => {
    const frame = {};
    const webContents = { mainFrame: frame };
    const window = { isDestroyed: () => false, webContents };
    expect(() => policy.assertTrustedIpcSender({ sender: webContents, senderFrame: frame }, window)).not.toThrow();
    expect(() => policy.assertTrustedIpcSender({ sender: {}, senderFrame: frame }, window)).toThrow(/Untrusted/);
    expect(() => policy.assertTrustedIpcSender({ sender: webContents, senderFrame: {} }, window)).toThrow(/Untrusted/);
  });

  it.each(['file:///tmp/secret', 'javascript:alert(1)', 'data:text/html,test', 'custom:test', 'https://attacker.example'])(
    'rejects unsafe external destination %s',
    (url) => expect(() => policy.validateExternalUrl(url)).toThrow(),
  );

  it('allows only managed paths', () => {
    const root = join(process.cwd(), `tmp-desktop-shell-${process.pid}`);
    expect(policy.validateOpenPath(join(root, 'diagnostic.log'), [root])).toContain(root);
    expect(() => policy.validateOpenPath(join(process.cwd(), '..', 'outside.txt'), [root])).toThrow(/outside/);
    rmSync(root, { recursive: true, force: true });
  });

  it('requires explicit support mode for packaged DevTools', () => {
    const desktopMain = readFileSync(join(process.cwd(), 'desktop', 'main.js'), 'utf8');
    expect(policy.productionDevToolsAllowed({ packaged: true, appDebug: true, supportMode: false })).toBe(false);
    expect(policy.productionDevToolsAllowed({ packaged: true, appDebug: true, supportMode: true })).toBe(true);
    expect(desktopMain).toContain('devTools: shouldOpenDebugTools()');
    expect(desktopMain).toContain('event.preventDefault()');
  });

  it('prevents a trusted Electron window from navigating into an untrusted web origin', () => {
    const input = { packagedEntryUrl: 'file:///C:/PatrolSafe/web/dist/index.html', developmentUrl: 'http://localhost:5173/' };
    expect(policy.isTrustedRendererNavigation('file:///C:/PatrolSafe/web/dist/index.html#/login', input)).toBe(true);
    expect(policy.isTrustedRendererNavigation('http://localhost:5173/#/login', input)).toBe(true);
    expect(policy.isTrustedRendererNavigation('https://attacker.example/', input)).toBe(false);
    expect(policy.isTrustedRendererNavigation('file:///C:/Windows/System32/drivers/etc/hosts', input)).toBe(false);
  });

  it('ships CSP and header-only media authorization', () => {
    const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
    const jwtGuard = readFileSync(join(process.cwd(), 'src', 'auth', 'guards', 'jwt-auth.guard.ts'), 'utf8');
    const evidence = readFileSync(join(process.cwd(), 'web', 'src', 'pages', 'evidence-page.tsx'), 'utf8');
    const dashboard = readFileSync(join(process.cwd(), 'web', 'src', 'pages', 'dashboard-page.tsx'), 'utf8');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("object-src 'none'");
    expect(jwtGuard).not.toContain('access_token');
    expect(`${evidence}\n${dashboard}`).not.toContain('access_token=');
  });

  it('protects desktop and licence mutations with guards', () => {
    const desktop = readFileSync(join(process.cwd(), 'src', 'desktop', 'desktop.controller.ts'), 'utf8');
    const licence = readFileSync(join(process.cwd(), 'src', 'licensing', 'license.controller.ts'), 'utf8');
    expect(desktop).toContain('@UseGuards(DesktopApiGuard)');
    expect(desktop).toContain('@UseGuards(DesktopInitializedMutationGuard)');
    expect(desktop).toContain('desktopRecoveryService.consume(recoveryToken)');
    expect(licence).toContain('@UseGuards(DesktopApiGuard)');
    expect(licence.match(/@UseGuards\(JwtAuthGuard\)/g)).toHaveLength(4);
  });

  it('keeps mapping, WhatsApp controls, and evidence behind bearer authentication', () => {
    for (const relativePath of [
      ['src', 'patrol-groups', 'patrol-groups.controller.ts'],
      ['src', 'collectors', 'collectors.controller.ts'],
      ['src', 'patrol-images', 'patrol-images.controller.ts'],
    ]) {
      const source = readFileSync(join(process.cwd(), ...relativePath), 'utf8');
      expect(source).toContain('@UseGuards(JwtAuthGuard');
    }
  });
});
