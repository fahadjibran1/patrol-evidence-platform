import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const {
  assertRuntimePackageManifest,
  isTestOnlyLicenseCorePath,
  pruneDesktopRuntimeWorkspacePayload,
} = require('../../scripts/lib/desktop-runtime-package-manifest') as {
  assertRuntimePackageManifest: (buildPath: string) => {
    runtimeRoot: string;
    requiredFiles: string[];
    fileCount: number;
  };
  isTestOnlyLicenseCorePath: (relativePath: string) => boolean;
  pruneDesktopRuntimeWorkspacePayload: (buildPath: string) => {
    removed: string[];
    manifest: { runtimeRoot: string; requiredFiles: string[]; fileCount: number };
  };
};

function write(root: string, relativePath: string, contents = 'fixture'): string {
  const targetPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, contents, 'utf8');
  return targetPath;
}

function createCopiedAppFixture(): string {
  const buildPath = fs.mkdtempSync(path.join(os.tmpdir(), 'patrolsafe-package-manifest-'));
  write(buildPath, 'packages/license-core/jest.config.js');
  write(buildPath, 'packages/license-core/src/index.ts');
  write(
    buildPath,
    'node_modules/@patrol/license-core/package.json',
    JSON.stringify({ name: '@patrol/license-core', main: 'dist/index.js' }),
  );
  write(buildPath, 'node_modules/@patrol/license-core/dist/index.js', 'module.exports = {};');
  write(buildPath, 'node_modules/@patrol/license-core/dist/license-crypto.js');
  write(buildPath, 'node_modules/@patrol/license-core/dist/license-crypto.d.ts');
  write(buildPath, 'node_modules/@patrol/license-core/dist/license-crypto.spec.js');
  write(buildPath, 'node_modules/@patrol/license-core/dist/license-crypto.spec.d.ts');
  write(buildPath, 'node_modules/@patrol/license-core/src/license-crypto.ts');
  write(buildPath, 'node_modules/@patrol/license-core/jest.config.js');
  write(buildPath, 'node_modules/@patrol/license-core/tsconfig.json');
  return buildPath;
}

describe('desktop runtime package manifest', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('recognizes test-only paths with Windows and POSIX separators', () => {
    expect(isTestOnlyLicenseCorePath('jest.config.js')).toBe(true);
    expect(isTestOnlyLicenseCorePath('src\\license-crypto.ts')).toBe(true);
    expect(isTestOnlyLicenseCorePath('dist/license-crypto.spec.js')).toBe(true);
    expect(isTestOnlyLicenseCorePath('dist\\license-crypto.spec.d.ts')).toBe(true);
    expect(isTestOnlyLicenseCorePath('dist/license-crypto.js')).toBe(false);
  });

  it('removes the duplicate workspace and keeps only required runtime package files', () => {
    const buildPath = createCopiedAppFixture();
    tempRoots.push(buildPath);

    const result = pruneDesktopRuntimeWorkspacePayload(buildPath);

    expect(fs.existsSync(path.join(buildPath, 'packages'))).toBe(false);
    expect(
      fs.existsSync(path.join(result.manifest.runtimeRoot, 'dist', 'index.js')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(result.manifest.runtimeRoot, 'dist', 'license-crypto.js')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(result.manifest.runtimeRoot, 'dist', 'license-crypto.spec.js')),
    ).toBe(false);
    expect(fs.existsSync(path.join(result.manifest.runtimeRoot, 'src'))).toBe(false);
    expect(fs.existsSync(path.join(result.manifest.runtimeRoot, 'jest.config.js'))).toBe(false);
  });

  it('fails closed when a runtime-required file is missing', () => {
    const buildPath = createCopiedAppFixture();
    tempRoots.push(buildPath);
    fs.rmSync(
      path.join(buildPath, 'node_modules', '@patrol', 'license-core', 'dist', 'index.js'),
    );
    fs.rmSync(path.join(buildPath, 'packages'), { recursive: true, force: true });

    expect(() => assertRuntimePackageManifest(buildPath)).toThrow(
      /required license-core runtime file missing/,
    );
  });

  it('fails closed while test-only workspace payload remains', () => {
    const buildPath = createCopiedAppFixture();
    tempRoots.push(buildPath);

    expect(() => assertRuntimePackageManifest(buildPath)).toThrow(/duplicate workspace tree/);
    fs.rmSync(path.join(buildPath, 'packages'), { recursive: true, force: true });
    expect(() => assertRuntimePackageManifest(buildPath)).toThrow(/test-only license-core files/);
  });

  it('declares an npm-pack runtime-only license-core manifest', () => {
    const packageMetadata = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'packages', 'license-core', 'package.json'), 'utf8'),
    ) as { files?: string[]; license?: string; private?: boolean };

    expect(packageMetadata.private).toBe(true);
    expect(packageMetadata.license).toBe('UNLICENSED');
    expect(packageMetadata.files).toContain('dist/**/*.js');
    expect(packageMetadata.files).toContain('!dist/**/*.spec.js');
    expect(packageMetadata.files).not.toContain('src');
    expect(packageMetadata.files).not.toContain('jest.config.js');
  });

  it('excludes the licensing-service Prisma client from the desktop package', () => {
    const forgeConfig = fs.readFileSync(path.join(process.cwd(), 'forge.config.js'), 'utf8');

    expect(forgeConfig).toContain("path.join('node_modules', '.prisma')");
    expect(forgeConfig).toContain('/^\\/node_modules\\/\\.prisma($|\\/)/');
  });

  it('keeps the Azure signing hook from mutating non-PE staging files', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'patrolsafe-signing-non-pe-'));
    tempRoots.push(tempRoot);
    const stagedConfig = write(tempRoot, 'folder with spaces/jest.config.js', 'module.exports = {};');
    const before = fs.readFileSync(stagedConfig);
    const signWindowsArtifact = require('../../scripts/artifact-signing-hook') as (
      filePath: string,
    ) => Promise<void>;

    await signWindowsArtifact(stagedConfig);

    expect(fs.readFileSync(stagedConfig)).toEqual(before);
  });
});
