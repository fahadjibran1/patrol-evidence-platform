import { readFileSync } from 'fs';
import * as path from 'path';
import {
  WHATSAPP_PUPPETEER_ARGS,
  buildWhatsAppWebClientOptions,
} from './whatsapp-web-runtime.config';

describe('Edge clean-machine first-link launch contract', () => {
  const projectRoot = process.cwd();

  it('keeps Edge Startup Boost from intercepting the owned DevTools generation', () => {
    expect(WHATSAPP_PUPPETEER_ARGS).toContain('--disable-features=msEdgeStartupBoost');

    const options = buildWhatsAppWebClientOptions({
      headless: false,
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    });
    expect(options.puppeteer.executablePath).toMatch(/msedge\.exe$/i);
    expect(options.puppeteer.args).toEqual(
      expect.arrayContaining([
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=msEdgeStartupBoost',
      ]),
    );
  });

  it('keeps the packaged runtime configuration in lockstep', () => {
    const packagedConfig = readFileSync(
      path.join(projectRoot, 'scripts', 'whatsapp-web-runtime-config.js'),
      'utf8',
    );
    expect(packagedConfig).toContain("'--disable-features=msEdgeStartupBoost'");
  });

  it('records DevTools readiness separately from profile ownership after launch failure', () => {
    const helper = readFileSync(
      path.join(projectRoot, 'src', 'collectors', 'whatsapp-helper.main.ts'),
      'utf8',
    );
    expect(helper).toContain('inspectDevToolsEndpoint(profileDir)');
    expect(helper).toContain('devToolsEndpoint=');
    expect(helper).toContain('classifyProfileOwners(lockAfterFailure.owners, currentBrowserRootPid)');
  });

  it('does not introduce a Chrome fallback into the launch arguments', () => {
    expect(WHATSAPP_PUPPETEER_ARGS.some((argument) => /chrome/i.test(argument))).toBe(false);
  });

  it('runs the packaged QR control against an isolated fresh Electron user-data root', () => {
    const smoke = readFileSync(
      path.join(projectRoot, 'scripts', 'smoke-packaged-whatsapp.js'),
      'utf8',
    );
    expect(smoke).toContain('`--user-data-dir=${configRoot}`');
    expect(smoke).toContain('/desktop/bootstrap/initialize');
    expect(smoke).toContain('/collectors/whatsapp/start');
  });
});
