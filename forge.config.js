const path = require('path');
const fs = require('fs');
const os = require('os');
const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { MakerDMG } = require('@electron-forge/maker-dmg');
const packageMetadata = require('./package.json');
const commercialStagingBuild = process.env.PATROLSAFE_COMMERCIAL_STAGING_BUILD === 'true';
const baseReleaseDisplayName =
  packageMetadata.displayName || packageMetadata.productName || 'PatrolSafe by S4';
const releaseDisplayName = commercialStagingBuild
  ? `${baseReleaseDisplayName} STAGING`
  : baseReleaseDisplayName;
const { getPackagerRuntimeIgnoreBlocklist } = require('./scripts/lib/electron-runtime-manifest');
const { ensureElectronRuntimeFiles } = require('./scripts/ensure-electron-runtime-files');
const {
  assertRuntimePackageManifest,
  pruneDesktopRuntimeWorkspacePayload,
} = require('./scripts/lib/desktop-runtime-package-manifest');
const {
  getTrackedPublicKeyPath,
  resolvePackagedPublicKeyPath,
  validatePublicKeyFile,
  logSafePublicKeyConfirmation,
  assertNoPrivateKeysInPaths,
} = require('./scripts/lib/license-public-key.util');

const trackedPublicKeyPath = getTrackedPublicKeyPath(__dirname);
const commercialStagingOrigin = 'https://patrolsafe-commercial-staging.onrender.com';
const commercialStagingKeyId = 'test-phase6-online-key';
const commercialStagingPublicKeyFileName = 'patrolsafe-staging-ed25519-public.pem';
const commercialStagingConfigFileName = 'patrolsafe-commercial-staging.json';
let commercialStagingExtraResources = [];

if (commercialStagingBuild) {
  const publicKeyPath = path.join(
    os.tmpdir(),
    'patrolsafe-staging-signing',
    commercialStagingPublicKeyFileName,
  );
  const publicKeyValidation = validatePublicKeyFile(
    publicKeyPath,
    'authorised staging online issuer public key',
  );
  logSafePublicKeyConfirmation(publicKeyPath, publicKeyValidation.keyObject);

  const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'patrolsafe-staging-package-'));
  const configPath = path.join(configDirectory, commercialStagingConfigFileName);
  fs.writeFileSync(configPath, `${JSON.stringify({
    schemaVersion: 1,
    staging: true,
    serviceOrigin: commercialStagingOrigin,
    purchaseOrigin: commercialStagingOrigin,
    onlineKeyId: commercialStagingKeyId,
    onlinePublicKeyFile: commercialStagingPublicKeyFileName,
  }, null, 2)}\n`, 'utf8');
  commercialStagingExtraResources = [publicKeyPath, configPath];
}

function resolveWindowsBuildVersion() {
  const fromPackage = String(packageMetadata.windowsBuild || '').trim();
  if (fromPackage) {
    const parts = fromPackage.split('.');
    if (parts.length >= 1 && parts.length <= 4 && parts.every((part) => /^\d+$/.test(part))) {
      return fromPackage;
    }
  }

  // Never fall back to display/buildId timestamps (can be 6-part and reject in Electron).
  return packageMetadata.version || '1.0.0';
}

const windowsBuildVersion = resolveWindowsBuildVersion();
if (String(windowsBuildVersion).split('.').length > 4) {
  throw new Error(
    `Electron Windows buildVersion must have at most 4 components. Got: ${windowsBuildVersion}`,
  );
}

const iconBasePath = path.resolve(__dirname, 'desktop', 'assets', 'patrolsafe');
const hasWindowsIcon = fs.existsSync(`${iconBasePath}.ico`);
const hasMacIcon = fs.existsSync(`${iconBasePath}.icns`);
const windowsIconUrl = String(packageMetadata.windowsIconUrl || '').trim();
const windowsSigningHookModule = String(process.env.PATROLSAFE_WINDOWS_SIGN_HOOK || '').trim();
const windowsReleaseKind = String(process.env.PATROLSAFE_WINDOWS_RELEASE || '')
  .trim()
  .toLowerCase();
const requiresWindowsSigning = ['commercial', 'production', 'release', 'rc'].includes(
  windowsReleaseKind,
);

if (requiresWindowsSigning && !windowsSigningHookModule) {
  throw new Error(
    `WINDOWS_RELEASE_SIGNING_REQUIRED PATROLSAFE_WINDOWS_RELEASE=${windowsReleaseKind} requires PATROLSAFE_WINDOWS_SIGN_HOOK.`,
  );
}

const windowsSign = windowsSigningHookModule
  ? {
      hookModulePath: path.resolve(windowsSigningHookModule),
      description: releaseDisplayName,
    }
  : undefined;
const packagerIgnore = [
  /^\/out($|\/)/,
  /^\/\.git($|\/)/,
  /^\/\.github($|\/)/,
  /^\/\.cursor($|\/)/,
  /^\/\.packtmp($|\/)/,
  /^\/src($|\/)/,
  /^\/test($|\/)/,
  /^\/tests($|\/)/,
  /^\/scripts($|\/)/,
  /^\/tools($|\/)/,
  /^\/Security_Patrols($|\/)/,
  /^\/whatsapp-session($|\/)/,
  /^\/whatsapp-session-test-events($|\/)/,
  /^\/\.wwebjs_cache($|\/)/,
  /^\/\.cache($|\/)/,
  /^\/cache($|\/)/i,
  /^\/logs($|\/)/i,
  /^\/tmp($|\/)/i,
  /^\/tmp-[^/]+($|\/)/i,
  // Preserved forensic runtimes are local diagnostics and must never enter a release artifact.
  /^\/\.tmp-phase10e-runtime[^/]*($|\/)/i,
  /^\/patrol-evidence-platform($|\/)/,
  /^\/apps($|\/)/,
  /^\/apps\/license-api($|\/)/,
  /^\/apps\/license-portal($|\/)/,
  /^\/docs($|\/)/,
  /^\/sqt($|\/)/,
  /^\/node_modules\/@patrol\/license-api($|\/)/,
  /^\/node_modules\/@patrol\/license-portal($|\/)/,
  /^\/node_modules\/\.prisma($|\/)/,
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
  /^\/web\/vitest\.config(\..+)?$/,
  /^\/\.env$/,
  /^\/\.env\..+$/,
  /^\/\.env\.example$/,
  /^\/\.license-keys($|\/)/,
  /\.private\.pem$/,
  /license-private/i,
  /^\/docker-compose(\..+)?\.yml$/,
  /^\/Dockerfile(\..+)?$/i,
  /^\/\.dockerignore$/,
  /^\/README\.md$/,
  /^\/CUSTOMER_HANDOVER_GUIDE\.md$/,
  /^\/RELEASE_NOTES\.md$/,
  /^\/RELEASE_FREEZE_NOTES\.md$/,
  /^\/TRIAL_RELEASE_CHECKLIST\.md$/,
  /^\/KNOWN_WORKING_CONFIG\.md$/,
  /^\/SYSTEM_STATUS\.md$/,
  /^\/codex\.patch$/,
  /^\/\.cursorignore$/,
  /^\/\.nvmrc$/,
  /^\/.*\.zip$/,
  /^\/.*\.tsbuildinfo$/,
  /^\/.*\.map$/,
  /^\/.*\.log$/,
  /^\/whatsapp-session-.*($|\/)/,
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
      'tools',
      'src',
      'test',
      'tests',
      'Security_Patrols',
      'whatsapp-session',
      'whatsapp-session-test-events',
      'patrol-evidence-platform',
      'whatsapp-session-raw-capture-test',
      'apps',
      'docs',
      'sqt',
      path.join('web', 'node_modules'),
      path.join('web', 'src'),
      path.join('node_modules', '@patrol', 'license-api'),
      path.join('node_modules', '@patrol', 'license-portal'),
      // Generated Prisma client belongs to the excluded licensing service,
      // not to the PatrolSafe desktop runtime.
      path.join('node_modules', '.prisma'),
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

    // Remove any tmp-* directories that slipped past ignore rules.
    for (const entryName of fs.readdirSync(buildPath)) {
      if (/^tmp-/i.test(entryName)) {
        removeIfPresent(path.join(buildPath, entryName));
      }
    }

    [
      'tmp-installer-verify.zip',
      'tmp-short-installer.zip',
      'patrol-evidence-platform.zip',
      'codex.patch',
      'README.md',
      'CUSTOMER_HANDOVER_GUIDE.md',
      'RELEASE_NOTES.md',
      'RELEASE_FREEZE_NOTES.md',
      'TRIAL_RELEASE_CHECKLIST.md',
      'KNOWN_WORKING_CONFIG.md',
      'SYSTEM_STATUS.md',
      'docker-compose.license-portal.yml',
      'docker-compose.yml',
      'Dockerfile',
      '.dockerignore',
      '.cursorignore',
      '.nvmrc',
      '.env',
      '.env.example',
      '.license-keys',
      '.eslintrc.cjs',
      'forge.config.js',
      'jest.config.ts',
      'nest-cli.json',
      'package-lock.json',
      'tsconfig.build.json',
      'tsconfig.json',
    ].forEach((fileName) => removeIfPresent(path.join(buildPath, fileName)));

    const runtimePrune = pruneDesktopRuntimeWorkspacePayload(buildPath);
    console.log(
      `[forge] Runtime workspace payload verified: license-core files=${runtimePrune.manifest.fileCount} removed=${runtimePrune.removed.length}`,
    );

    callback();
  } catch (error) {
    callback(error);
  }
}

module.exports = {
  hooks: {
    prePackage: async () => {
      const backendEntryPath = path.join(__dirname, 'dist', 'main.js');
      if (!fs.existsSync(backendEntryPath)) {
        throw new Error(
          `PACKAGED_BACKEND_MISSING Pre-package check failed: ${backendEntryPath} does not exist. Run npm run build before packaging.`,
        );
      }

      const frontendEntryPath = path.join(__dirname, 'web', 'dist', 'index.html');
      if (!fs.existsSync(frontendEntryPath)) {
        throw new Error(
          `PACKAGED_FRONTEND_MISSING Pre-package check failed: ${frontendEntryPath} does not exist. Run npm run frontend:build before packaging.`,
        );
      }

      if (!fs.existsSync(trackedPublicKeyPath)) {
        throw new Error(
          'LICENSE_PUBLIC_KEY_PACKAGE_VALIDATION_FAILED resources/license-public.pem is missing. Copy .license-keys/license-public.pem before packaging.',
        );
      }

      const validation = validatePublicKeyFile(trackedPublicKeyPath, 'resources/license-public.pem');
      logSafePublicKeyConfirmation(trackedPublicKeyPath, validation.keyObject);
      assertNoPrivateKeysInPaths([path.join(__dirname, 'resources')], 'Pre-package resources safety check');
      if (commercialStagingBuild && commercialStagingExtraResources.length !== 2) {
        throw new Error('COMMERCIAL_STAGING_PACKAGE_INPUT_MISSING');
      }
    },
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

        const {
          getBackendEntryCandidates,
          getPackagedAppRoot,
        } = require('./desktop/packaged-runtime-paths');
        const packagedResourcesPath = path.join(outputPath, 'resources');
        const packagedAppRoot =
          getPackagedAppRoot({ resourcesPath: packagedResourcesPath }) ||
          path.join(packagedResourcesPath, 'app');
        assertRuntimePackageManifest(packagedAppRoot);
        const backendResolution = getBackendEntryCandidates({
          appRoot: packagedAppRoot,
          resourcesPath: packagedResourcesPath,
          dirnameHint: packagedAppRoot,
          packaged: true,
        });
        if (!backendResolution.resolved) {
          throw new Error(
            `PACKAGED_BACKEND_MISSING Post-package check failed under ${outputPath}. Expected resources/app/dist/main.js.`,
          );
        }
        console.log(`[forge] Packaged backend entry: ${backendResolution.resolved}`);

        const packagedFrontendEntry = path.join(
          outputPath,
          'resources',
          'app',
          'web',
          'dist',
          'index.html',
        );
        if (!fs.existsSync(packagedFrontendEntry)) {
          throw new Error(
            `PACKAGED_FRONTEND_MISSING Post-package check failed under ${outputPath}. Expected resources/app/web/dist/index.html.`,
          );
        }

        const packagedPublicKeyPath = resolvePackagedPublicKeyPath(outputPath);
        if (!packagedPublicKeyPath) {
          throw new Error(
            `LICENSE_PUBLIC_KEY_PACKAGE_VALIDATION_FAILED Packaged public key missing under ${outputPath}. Expected resources/license-public.pem via extraResource.`,
          );
        }

        const validation = validatePublicKeyFile(packagedPublicKeyPath, packagedPublicKeyPath);
        console.log(`LICENSE_PUBLIC_KEY_PACKAGED path=${packagedPublicKeyPath}`);
        logSafePublicKeyConfirmation(packagedPublicKeyPath, validation.keyObject);
        if (commercialStagingBuild) {
          const stagingConfigPath = path.join(packagedResourcesPath, commercialStagingConfigFileName);
          const stagingPublicKeyPath = path.join(packagedResourcesPath, commercialStagingPublicKeyFileName);
          if (!fs.existsSync(stagingConfigPath)) {
            throw new Error('COMMERCIAL_STAGING_CONFIG_PACKAGE_VALIDATION_FAILED');
          }
          const stagingConfig = JSON.parse(fs.readFileSync(stagingConfigPath, 'utf8'));
          if (
            stagingConfig.serviceOrigin !== commercialStagingOrigin
            || stagingConfig.purchaseOrigin !== commercialStagingOrigin
            || stagingConfig.onlineKeyId !== commercialStagingKeyId
          ) {
            throw new Error('COMMERCIAL_STAGING_CONFIG_IDENTITY_MISMATCH');
          }
          const onlineValidation = validatePublicKeyFile(stagingPublicKeyPath, stagingPublicKeyPath);
          logSafePublicKeyConfirmation(stagingPublicKeyPath, onlineValidation.keyObject);
          console.log(
            `COMMERCIAL_STAGING_PACKAGE_VALID origin=${commercialStagingOrigin} keyId=${commercialStagingKeyId}`,
          );
        }
        assertNoPrivateKeysInPaths([outputPath], 'Post-package safety check');
      }
    },
  },
  packagerConfig: {
    asar: false,
    prune: true,
    // Windows packaging must copy workspace package contents instead of recreating npm symlinks.
    derefSymlinks: true,
    name: releaseDisplayName,
    executableName: 'PatrolEvidencePlatform',
    appVersion: packageMetadata.version,
    // Electron FILEVERSION / productVersion — must be 1–4 numeric components.
    buildVersion: windowsBuildVersion,
    appCopyright:
      packageMetadata.copyright || '© 2026 Vesoft Services Limited. All rights reserved.',
    electronDist: path.join(__dirname, 'node_modules', 'electron', 'dist'),
    icon: hasWindowsIcon || hasMacIcon ? iconBasePath : undefined,
    windowsSign,
    extraResource: [
      ...(fs.existsSync(trackedPublicKeyPath) ? [trackedPublicKeyPath] : []),
      ...commercialStagingExtraResources,
      // Vendored WhatsApp Web HTML pin for whatsapp-web.js LocalWebCache (survives src prune).
      ...(fs.existsSync(path.join(__dirname, 'src', 'collectors', 'wa-web-cache'))
        ? [path.join(__dirname, 'src', 'collectors', 'wa-web-cache')]
        : []),
      ...(fs.existsSync(path.join(__dirname, 'resources', 'whatsapp-web-cache'))
        ? [path.join(__dirname, 'resources', 'whatsapp-web-cache')]
        : []),
    ],
    ignore: shouldIgnorePackagePath,
    afterCopy: [pruneCopiedApp],
    win32metadata: {
      CompanyName: packageMetadata.companyName || 'Vesoft Services Limited',
      FileDescription: releaseDisplayName,
      OriginalFilename: 'PatrolEvidencePlatform.exe',
      ProductName: releaseDisplayName,
      InternalName: 'PatrolEvidencePlatform',
      LegalCopyright:
        packageMetadata.copyright || '© 2026 Vesoft Services Limited. All rights reserved.',
    },
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
      name: commercialStagingBuild ? 'patrolsafe_commercial_staging' : 'patrol_evidence_platform',
      title: releaseDisplayName,
      authors: packageMetadata.companyName || packageMetadata.author || 'Vesoft Services Limited',
      owners: packageMetadata.companyName || packageMetadata.author || 'Vesoft Services Limited',
      // Squirrel maps this field into Setup.exe ProductName/FileDescription.
      description: releaseDisplayName,
      exe: 'PatrolEvidencePlatform.exe',
      setupExe: commercialStagingBuild
        ? 'PatrolSafe-v1.0.3-Commercial-Staging-Setup.exe'
        : 'PatrolEvidencePlatformSetup.exe',
      setupIcon: hasWindowsIcon ? `${iconBasePath}.ico` : undefined,
      iconUrl: windowsIconUrl || undefined,
      skipUpdateIcon: false,
      windowsSign,
      // Full installs avoid Squirrel delta packages missing Chromium ICU/snapshot files on target PCs.
      noDelta: true,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({}, ['darwin']),
  ],
};
