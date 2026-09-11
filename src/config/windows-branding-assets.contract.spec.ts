import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const projectRoot = path.resolve(__dirname, '../..');
const assetRoot = path.join(projectRoot, 'desktop', 'assets');

function read(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function readPngDimensions(filePath: string): { width: number; height: number; colorType: number } {
  const png = readFileSync(filePath);
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png.readUInt8(25),
  };
}

describe('PatrolSafe Windows branding assets', () => {
  it('retains the approved master and transparent PNG derivatives at every required size', () => {
    const master = readPngDimensions(
      path.join(projectRoot, 'desktop', 'assets-source', 'patrolsafe-4p-master.png'),
    );
    expect(master).toEqual({ width: 1254, height: 1254, colorType: 2 });

    for (const size of [16, 24, 32, 48, 64, 128, 256]) {
      expect(readPngDimensions(path.join(assetRoot, `icon-${size}.png`))).toEqual({
        width: size,
        height: size,
        colorType: 6,
      });
    }
  });

  it('contains a genuine seven-frame, 32-bit Windows ICO', () => {
    const ico = readFileSync(path.join(assetRoot, 'patrolsafe.ico'));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(7);

    const frames = Array.from({ length: 7 }, (_, index) => {
      const offset = 6 + index * 16;
      return {
        width: ico.readUInt8(offset) || 256,
        height: ico.readUInt8(offset + 1) || 256,
        planes: ico.readUInt16LE(offset + 4),
        bits: ico.readUInt16LE(offset + 6),
      };
    });
    expect(frames).toEqual(
      [16, 24, 32, 48, 64, 128, 256].map((size) => ({
        width: size,
        height: size,
        planes: 1,
        bits: 32,
      })),
    );
  });

  it('uses the approved icon for the executable, window, installer, updater and About dialog', () => {
    const forge = read('forge.config.js');
    const desktopMain = read('desktop/main.js');
    const aboutDialog = read('web/src/components/about-dialog.tsx');

    expect(forge).toContain("'assets', 'patrolsafe'");
    expect(forge).toContain('icon: hasWindowsIcon || hasMacIcon ? iconBasePath : undefined');
    expect(forge).toContain('setupIcon: hasWindowsIcon ? `${iconBasePath}.ico` : undefined');
    expect(forge).toContain('skipUpdateIcon: false');
    expect(forge).toContain('iconUrl: windowsIconUrl || undefined');
    expect(forge).toContain('description: releaseDisplayName');
    expect(desktopMain).toContain("icon: path.join(__dirname, 'assets', 'patrolsafe.ico')");
    expect(aboutDialog).toContain('src="./patrolsafe-icon.png"');
  });

  it('publishes Vesoft metadata while retaining compatibility identities', () => {
    const metadata = JSON.parse(read('package.json')) as Record<string, string>;
    const forge = read('forge.config.js');
    const helper = read('src/collectors/whatsapp-helper.main.ts');

    expect(metadata.displayName).toBe('PatrolSafe by S4');
    expect(metadata.companyName).toBe('Vesoft Services Limited');
    expect(metadata.author).toBe('Vesoft Services Limited');
    expect(metadata.description).toBe('Patrol evidence. Automatically organised.');
    expect(metadata.copyright).toBe('© 2026 Vesoft Services Limited. All rights reserved.');
    expect(metadata.name).toBe('patrol-evidence-platform');
    expect(metadata.productName).toBe('Patrol Evidence Platform');
    expect(forge).toContain("executableName: 'PatrolEvidencePlatform'");
    expect(forge).toContain("setupExe: 'PatrolEvidencePlatformSetup.exe'");
    expect(helper).toContain("const SESSION_PROFILE_DIR = 'session-patrol-evidence-platform'");
    expect(helper).toContain("const LOCAL_AUTH_CLIENT_ID = 'patrol-evidence-platform'");
  });

  it('provides a secret-free Azure signing hook for both package and installer signing', () => {
    const forge = read('forge.config.js');
    expect(forge).toContain('process.env.PATROLSAFE_WINDOWS_SIGN_HOOK');
    expect(forge.match(/windowsSign,/g)).toHaveLength(2);
    expect(read('docs/release/azure-signing.md')).toContain('Vesoft Services Limited');
  });
});
