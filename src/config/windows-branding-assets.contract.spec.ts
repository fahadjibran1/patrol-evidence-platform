import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

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
    expect(forge).toContain("? 'PatrolSafe-v1.0.3-Commercial-Staging-Setup.exe'");
    expect(forge).toContain(": 'PatrolEvidencePlatformSetup.exe'");
    expect(helper).toContain("const SESSION_PROFILE_DIR = 'session-patrol-evidence-platform'");
    expect(helper).toContain("const LOCAL_AUTH_CLIENT_ID = 'patrol-evidence-platform'");
  });

  it('provides a secret-free Azure signing hook for both package and installer signing', () => {
    const forge = read('forge.config.js');
    const hook = read('scripts/artifact-signing-hook.js');
    const signedRelease = read('scripts/build-signed-windows-rc.js');
    const verification = read('scripts/verify-windows-signatures.ps1');
    expect(forge).toContain('process.env.PATROLSAFE_WINDOWS_SIGN_HOOK');
    expect(forge.match(/windowsSign,/g)).toHaveLength(2);
    expect(forge).toContain('WINDOWS_RELEASE_SIGNING_REQUIRED');
    expect(hook).toContain("const ACCOUNT_NAME = 'vesoft-signing-prod'");
    expect(hook).toContain("const CERTIFICATE_PROFILE_NAME = 'vesoft-public-trust'");
    expect(hook).toContain("const ENDPOINT = 'https://neu.codesigning.azure.net/'");
    expect(hook).toContain("const TIMESTAMP_URL = 'http://timestamp.acs.microsoft.com/'");
    expect(hook).not.toMatch(/AccessToken|clientSecret|password/i);
    expect(signedRelease).toContain("PATROLSAFE_WINDOWS_RELEASE: 'rc'");
    expect(signedRelease).toContain('patrolsafe-${releaseVersion}-private-rc-');
    expect(signedRelease).toContain("'-ExpectedReleaseVersion'");
    expect(signedRelease).toContain(
      "process.env.PATROLSAFE_COMMERCIAL_STAGING_BUILD === 'true'",
    );
    expect(signedRelease).toContain("'PatrolSafe by S4 STAGING'");
    expect(signedRelease).toContain("'-ExpectedProductName'");
    expect(signedRelease).toContain("['-IBm', 'azure.cli', 'account', 'show'");
    expect(signedRelease).toContain('verify-windows-signatures.ps1');
    expect(verification).toContain("$ExpectedPublisher = 'Vesoft Services Limited'");
    expect(verification).toContain('releaseVersion = $ExpectedReleaseVersion');
    expect(verification).not.toContain("releaseVersion = '1.0.0'");
    expect(verification).toContain('SIGNATURE_TIMESTAMP_MISSING');
    expect(read('docs/release/azure-signing.md')).toContain('Vesoft Services Limited');
  });

  it('excludes preserved forensic runtime directories from packaged releases', () => {
    const forge = read('forge.config.js');
    const verification = read('scripts/verify-windows-signatures.ps1');
    expect(forge).toContain('/^\\/\\.tmp-phase10e-runtime[^/]*($|\\/)/i');
    expect(verification).toContain('RELEASE_ARTIFACT_CONTAINS_FORENSIC_RUNTIME');
    expect(verification).toContain('RELEASE_NUPKG_CONTAINS_FORENSIC_RUNTIME');
  });

  it('fails closed when an RC build has no signing hook', () => {
    const result = spawnSync(process.execPath, ['-e', "require('./forge.config.js')"], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATROLSAFE_WINDOWS_RELEASE: 'rc',
        PATROLSAFE_WINDOWS_SIGN_HOOK: '',
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('WINDOWS_RELEASE_SIGNING_REQUIRED');
  });

  it('builds the Microsoft-supported SHA-256 Artifact Signing invocation', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const hook = require(path.join(projectRoot, 'scripts', 'artifact-signing-hook.js')) as {
      buildSignToolArgs: (file: string, dlib: string, metadata: string) => string[];
    };
    expect(hook.buildSignToolArgs('app.exe', 'artifact-signing.dll', 'metadata.json')).toEqual([
      'sign',
      '/v',
      '/debug',
      '/fd',
      'SHA256',
      '/tr',
      'http://timestamp.acs.microsoft.com/',
      '/td',
      'SHA256',
      '/dlib',
      'artifact-signing.dll',
      '/dmdf',
      'metadata.json',
      'app.exe',
    ]);
  });

  it('keeps Windows signature path validation compatible with Windows PowerShell 5.1', () => {
    const verification = read('scripts/verify-windows-signatures.ps1');
    expect(verification).not.toContain('[System.IO.Path]::GetRelativePath');
    expect(verification).toContain('Get-PatrolSafeRelativePath');
    expect(verification).toContain('RELATIVE_PATH_OUTSIDE_RELEASE_ROOT');

    if (process.platform !== 'win32') {
      return;
    }

    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/verify-windows-signatures.ps1', '-SelfTest'],
      { cwd: projectRoot, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('WINDOWS_SIGNATURE_VERIFIER_SELF_TEST_OK cases=4');
  });

  it('fails closed when a requested signature-verification artifact is missing', () => {
    const verification = read('scripts/verify-windows-signatures.ps1');
    expect(verification).toContain('SIGNATURE_VERIFY_ARTIFACT_MISSING');
    expect(verification).toContain('SIGNATURE_INVALID');
    expect(verification).toContain('SIGNATURE_WRONG_PUBLISHER');

    if (process.platform !== 'win32') {
      return;
    }

    const missingPath = path.join(projectRoot, 'out', 'does-not-exist.exe');
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'scripts/verify-windows-signatures.ps1',
        '-VerifyFile',
        missingPath,
      ],
      { cwd: projectRoot, encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('SIGNATURE_VERIFY_ARTIFACT_MISSING');
  });
});
