const path = require('path');
const fs = require('fs');
const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerDMG } = require('@electron-forge/maker-dmg');
const packageMetadata = require('./package.json');
const { getPackagerRuntimeIgnoreBlocklist } = require('./scripts/lib/electron-runtime-manifest');
const { ensureElectronRuntimeFiles } = require('./scripts/ensure-electron-runtime-files');

const iconBasePath = path.resolve(__dirname, 'desktop', 'assets', 'icon');
const hasWindowsIcon = fs.existsSync(`${iconBasePath}.ico`);
const hasMacIcon = fs.existsSync(`${iconBasePath}.icns`);
const packagerIgnore = [
  /^\/out($|\/)/,
  /^\/\.git($|\/)/,
  /^\/\.github($|\/)/,
  /^\/\.packtmp($|\/)/,
  /^\/src($|\/)/,
  /^\/test($|\/)/,
  /^\/tests($|\/)/,
  /^\/scripts($|\/)/,
  /^\/Security_Patrols($|\/)/,
  /^\/whatsapp-session($|\/)/,
  /^\/whatsapp-session-test-events($|\/)/,
  /^\/\.wwebjs_cache($|\/)/,
  /^\/\.cache($|\/)/,
  /^\/cache($|\/)/i,
  /^\/logs($|\/)/i,
  /^\/tmp($|\/)/i,
  /^\/tmp-installer-verify($|\/)/,
  /^\/tmp-short-installer($|\/)/,
  /^\/tmp-portable-verify($|\/)/,
  /^\/patrol-evidence-platform($|\/)/,
  /^\/node_modules\/puppeteer-core\/\.local-chromium($|\/)/,
  /^\/node_modules\/puppeteer\/\.local-chromium($|\/)/,
  /^\/node_modules\/.*\/test($|\/)/i,
  /^\/node_modules\/.*\/tests($|\/)/i,
  /^\/node_modules\/.*\/\.cache($|\/)/i,
  /^\/node_modules\/.*\/\.github($|\/)/i,
  /^\/web\/node_modules($|\/)/,
  /^\/web\/src($|\/)/,
  /^\/web\/package-lock\.json$/,
  /^\/web\/tsconfig(\..+)?$/,
  /^\/web\/vite\.config(\..+)?$/,
  /^\/\.env$/,
  /^\/\.env\..+$/,
  /^\/\.env\.example$/,
  /^\/README\.md$/,
  /^\/CUSTOMER_HANDOVER_GUIDE\.md$/,
  /^\/RELEASE_NOTES\.md$/,
  /^\/TRIAL_RELEASE_CHECKLIST\.md$/,
  /^\/codex\.patch$/,
  /^\/.*\.zip$/,
  /^\/.*\.tsbuildinfo$/,
  /^\/.*\.map$/,
  /^\/.*\.log$/,
  /^\/whatsapp-session-.*($|\/)/
];

function normalizePackagePath(filePath) {
  const normalizedFilePath = filePath.replace(/\\/g, '/');
  const normalizedRoot = __dirname.replace(/\\/g, '/');

  if (normalizedFilePath === normalizedRoot) {
    return '/';
  }

  if (normalizedFilePath.startsWith(`${normalizedRoot}/`)) {
    return `/${normalizedFilePath.slice(normalizedRoot.length + 1)}`;
  }

  return normalizedFilePath.startsWith('/') ? normalizedFilePath : `/${normalizedFilePath}`;
}

const packagerRuntimeIgnoreBlocklist = new Set(getPackagerRuntimeIgnoreBlocklist());

function shouldIgnorePackagePath(filePath) {
  const packagePath = normalizePackagePath(filePath);
  const baseName = path.basename(filePath);

  // Never exclude Electron/Chromium shell files if they appear in the project tree.
  if (packagerRuntimeIgnoreBlocklist.has(baseName)) {
    return false;
  }

  if (/\/locales(\/|$)/i.test(packagePath) && packagePath.endsWith('.pak')) {
    return false;
  }

  return packagerIgnore.some((pattern) => pattern.test(packagePath));
}

function removeIfPresent(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function pruneCopiedApp(buildPath, _electronVersion, _platform, _arch, callback) {
  try {
    [
      '.git',
      '.github',
      '.packtmp',
      '.wwebjs_cache',
      '.cache',
      'logs',
      'out',
      'scripts',
      'src',
      'test',
      'tests',
      'Security_Patrols',
      'tmp-installer-verify',
      'tmp-short-installer',
      'tmp-portable-verify',
      'whatsapp-session',
      'whatsapp-session-test-events',
      'patrol-evidence-platform',
      'whatsapp-session-raw-capture-test',
      path.join('web', 'node_modules'),
      path.join('web', 'src'),
      path.join('node_modules', 'puppeteer-core', '.local-chromium'),
      path.join('node_modules', 'puppeteer', '.local-chromium'),
      path.join('node_modules', 'electron'),
      path.join('node_modules', '@electron'),
      path.join('node_modules', '@electron-forge'),
      path.join('node_modules', 'electron-winstaller'),
      path.join('node_modules', 'electron-installer-dmg'),
      path.join('node_modules', 'electron-rebuild'),
      path.join('node_modules', 'electron-squirrel-startup'),
      path.join('node_modules', 'typescript'),
      path.join('node_modules', 'ts-node'),
      path.join('node_modules', 'ts-jest'),
      path.join('node_modules', 'tsconfig-paths'),
      path.join('node_modules', '@nestjs', 'cli'),
      path.join('node_modules', '@nestjs', 'schematics'),
      path.join('node_modules', '@nestjs', 'testing'),
      path.join('node_modules', '@angular-devkit'),
      path.join('node_modules', '@typescript-eslint'),
      path.join('node_modules', 'eslint'),
      path.join('node_modules', 'jest'),
      path.join('node_modules', 'prettier'),
      path.join('node_modules', 'supertest'),
      path.join('node_modules', 'concurrently'),
      path.join('node_modules', 'wait-on'),
      path.join('node_modules', 'better-sqlite3', 'deps'),
    ].forEach((relativePath) => removeIfPresent(path.join(buildPath, relativePath)));

    [
      'tmp-installer-verify.zip',
      'tmp-short-installer.zip',
      'patrol-evidence-platform.zip',
      'codex.patch',
      'README.md',
      'CUSTOMER_HANDOVER_GUIDE.md',
      'RELEASE_NOTES.md',
      'TRIAL_RELEASE_CHECKLIST.md',
      '.env',
      '.env.example',
      '.eslintrc.cjs',
      'forge.config.js',
      'jest.config.ts',
      'package-lock.json',
      'tsconfig.build.json',
      'tsconfig.json',
    ].forEach((fileName) => removeIfPresent(path.join(buildPath, fileName)));

    callback();
  } catch (error) {
    callback(error);
  }
}

module.exports = {
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      if (!packageResult || packageResult.platform !== 'win32') {
        return;
      }

      for (const outputPath of packageResult.outputPaths || []) {
        const repair = ensureElectronRuntimeFiles(outputPath, __dirname);
        if (repair.copied.length > 0) {
          console.log(
            `[forge] Repaired Electron shell runtime files in ${outputPath}: ${repair.copied.join(', ')}`,
          );
        }
      }
    },
  },
  packagerConfig: {
    asar: false,
    prune: true,
    executableName: 'PatrolEvidencePlatform',
    electronDist: path.join(__dirname, 'node_modules', 'electron', 'dist'),
    icon: hasWindowsIcon || hasMacIcon ? iconBasePath : undefined,
    extraResource: [],
    ignore: shouldIgnorePackagePath,
    afterCopy: [pruneCopiedApp],
    osxSign: process.env.APPLE_IDENTITY
      ? {
          identity: process.env.APPLE_IDENTITY,
        }
      : undefined,
    osxNotarize:
      process.env.APPLE_ID && process.env.APPLE_ID_PASSWORD && process.env.APPLE_TEAM_ID
        ? {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_ID_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          }
        : undefined,
  },
  rebuildConfig: {
    force: true,
    onlyModules: ['better-sqlite3', 'sharp'],
  },
  makers: [
    new MakerSquirrel({
      name: 'patrol_evidence_platform',
      authors: packageMetadata.author,
      description: packageMetadata.description,
      exe: 'PatrolEvidencePlatform.exe',
      setupExe: 'PatrolEvidencePlatformSetup.exe',
      setupIcon: hasWindowsIcon ? `${iconBasePath}.ico` : undefined,
      // Full installs avoid Squirrel delta packages missing Chromium ICU/snapshot files on target PCs.
      noDelta: true,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({}, ['darwin']),
  ],
};
