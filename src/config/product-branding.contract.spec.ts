import { readFileSync } from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

describe('PatrolSafe release branding contract', () => {
  it('publishes the approved customer-facing brand and tagline', () => {
    const packageMetadata = JSON.parse(read('package.json')) as Record<string, string>;

    expect(packageMetadata.displayName).toBe('PatrolSafe by S4');
    expect(packageMetadata.brandName).toBe('PatrolSafe');
    expect(packageMetadata.endorsement).toBe('by S4');
    expect(packageMetadata.tagline).toBe('Patrol evidence. Automatically organised.');
    expect(packageMetadata.companyName).toBe('Vesoft Services Limited');
    expect(packageMetadata.copyright).toBe('© 2026 Vesoft Services Limited. All rights reserved.');
    expect(read('web/index.html')).toContain('<title>PatrolSafe by S4</title>');
    expect(read('web/src/lib/product-info.ts')).toContain("productName: 'PatrolSafe by S4'");
  });

  it('uses the display brand for Electron and Windows release metadata', () => {
    const forgeConfig = read('forge.config.js');
    const desktopMain = read('desktop/main.js');

    expect(forgeConfig).toContain('const releaseDisplayName');
    expect(forgeConfig).toContain('FileDescription: releaseDisplayName');
    expect(forgeConfig).toContain('ProductName: releaseDisplayName');
    expect(forgeConfig).toContain('title: releaseDisplayName');
    expect(desktopMain).toContain("packageMetadata.displayName || packageMetadata.productName || 'PatrolSafe by S4'");
    expect(desktopMain).toContain('title: PRODUCT_METADATA.productName');
  });

  it('keeps installed executable and package identifiers compatible', () => {
    const packageMetadata = JSON.parse(read('package.json')) as Record<string, string>;
    const forgeConfig = read('forge.config.js');

    expect(packageMetadata.name).toBe('patrol-evidence-platform');
    expect(packageMetadata.productName).toBe('Patrol Evidence Platform');
    expect(forgeConfig).toContain("executableName: 'PatrolEvidencePlatform'");
    expect(forgeConfig).toContain("name: 'patrol_evidence_platform'");
    expect(forgeConfig).toContain("setupExe: 'PatrolEvidencePlatformSetup.exe'");
  });

  it('preserves the certified WhatsApp LocalAuth identity and session directory', () => {
    const helper = read('src/collectors/whatsapp-helper.main.ts');

    expect(helper).toContain("const SESSION_PROFILE_DIR = 'session-patrol-evidence-platform'");
    expect(helper).toContain("const LOCAL_AUTH_CLIENT_ID = 'patrol-evidence-platform'");
  });

  it('preserves the signed TG1 licence compatibility identity', () => {
    expect(read('packages/license-core/src/commercial.types.ts')).toContain(
      "export const LICENCE_PRODUCT_NAME = 'Patrol Evidence Platform'",
    );
  });
});
