const { existsSync, readFileSync } = require('fs');
const path = require('path');

const WHATSAPP_WEB_VERSION =
  process.env.PATROL_WHATSAPP_WEB_VERSION?.trim() || '2.3000.1040111714-alpha';

function candidateWhatsAppWebVersionCacheDirs() {
  const fromEnv = process.env.PATROL_WHATSAPP_WEB_VERSION_CACHE_PATH?.trim();
  const resourcesPath = process.env.PATROL_RESOURCES_PATH?.trim();
  const appPath = process.env.PATROL_APP_PATH?.trim();

  return [
    fromEnv,
    path.join(__dirname, '..', 'dist', 'collectors', 'wa-web-cache'),
    path.join(__dirname, '..', 'src', 'collectors', 'wa-web-cache'),
    path.join(__dirname, '..', 'resources', 'whatsapp-web-cache'),
    path.join(__dirname, '..', 'resources', 'wa-web-cache'),
    resourcesPath ? path.join(resourcesPath, 'wa-web-cache') : '',
    resourcesPath ? path.join(resourcesPath, 'whatsapp-web-cache') : '',
    appPath ? path.join(appPath, 'resources', 'wa-web-cache') : '',
    appPath ? path.join(appPath, 'resources', 'whatsapp-web-cache') : '',
    path.join(process.cwd(), 'dist', 'collectors', 'wa-web-cache'),
    path.join(process.cwd(), 'src', 'collectors', 'wa-web-cache'),
    path.join(process.cwd(), 'resources', 'whatsapp-web-cache'),
    path.join(process.cwd(), 'resources', 'wa-web-cache'),
  ].filter(Boolean);
}

function resolveWhatsAppWebVersionCacheDir() {
  const versionFile = `${WHATSAPP_WEB_VERSION}.html`;
  for (const candidate of candidateWhatsAppWebVersionCacheDirs()) {
    if (existsSync(path.join(candidate, versionFile))) {
      return candidate;
    }
  }
  return null;
}

function resolveWhatsAppWebVersionCache() {
  const forceRemote = process.env.PATROL_WHATSAPP_WEB_VERSION_CACHE_TYPE?.trim() === 'remote';
  if (forceRemote) {
    return {
      type: 'remote',
      remotePath:
        process.env.PATROL_WHATSAPP_WEB_VERSION_CACHE_URL?.trim() ||
        'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
      strict: process.env.PATROL_WHATSAPP_WEB_VERSION_STRICT !== 'false',
    };
  }

  const localPath = resolveWhatsAppWebVersionCacheDir();
  if (!localPath) {
    throw new Error(
      `WhatsApp Web version cache missing for ${WHATSAPP_WEB_VERSION}. ` +
        `Expected ${WHATSAPP_WEB_VERSION}.html under src/collectors/wa-web-cache or resources/whatsapp-web-cache. ` +
        `Set PATROL_WHATSAPP_WEB_VERSION_CACHE_PATH to override.`,
    );
  }

  return {
    type: 'local',
    path: localPath,
    strict: process.env.PATROL_WHATSAPP_WEB_VERSION_STRICT !== 'false',
  };
}

function getWhatsAppWebVersionCache() {
  return resolveWhatsAppWebVersionCache();
}

function readWhatsAppRuntimePackageVersions() {
  const readVersion = (packageName) => {
    try {
      const packageJsonPath = require.resolve(`${packageName}/package.json`);
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      return packageJson.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  };

  return {
    whatsappWebJs: readVersion('whatsapp-web.js'),
    puppeteer: readVersion('puppeteer'),
    puppeteerCore: readVersion('puppeteer-core'),
  };
}

const WHATSAPP_PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
];

function buildWhatsAppPuppeteerOptions({ headless, executablePath, dumpio = false }) {
  return {
    headless,
    executablePath,
    dumpio,
    args: [...WHATSAPP_PUPPETEER_ARGS],
  };
}

function resolveBrowserExecutableCandidates() {
  const configured =
    process.env.WA_TEST_BROWSER_PATH?.trim() ||
    process.env.PATROL_HELPER_EDGE_PATH?.trim() ||
    process.env.PATROL_HELPER_CHROME_PATH?.trim() ||
    process.env.WHATSAPP_CHROME_PATH?.trim() ||
    '';

  return [
    configured,
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
}

function resolveBrowserExecutable() {
  const seen = new Set();

  for (const candidate of resolveBrowserExecutableCandidates()) {
    const normalized = path.normalize(candidate);
    if (seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    if (existsSync(normalized)) {
      return normalized;
    }
  }

  throw new Error(
    'No browser executable found. Set WA_TEST_BROWSER_PATH to msedge.exe or chrome.exe.',
  );
}

function buildWhatsAppWebClientOptions({ headless, executablePath }) {
  return {
    webVersion: WHATSAPP_WEB_VERSION,
    webVersionCache: getWhatsAppWebVersionCache(),
    puppeteer: buildWhatsAppPuppeteerOptions({ headless, executablePath }),
  };
}

function formatWhatsAppRuntimeConfigSummary() {
  const versions = readWhatsAppRuntimePackageVersions();
  const cache = getWhatsAppWebVersionCache();
  const cachePath = cache.type === 'local' ? cache.path : 'remote';
  return [
    `wwebjs=${versions.whatsappWebJs}`,
    `puppeteer=${versions.puppeteer}`,
    `puppeteerCore=${versions.puppeteerCore}`,
    `webVersion=${WHATSAPP_WEB_VERSION}`,
    `webVersionCache=${cache.type}`,
    `webVersionCachePath=${cachePath}`,
    `webVersionCacheStrict=${cache.strict}`,
  ].join(' ');
}

module.exports = {
  WHATSAPP_WEB_VERSION,
  get WHATSAPP_WEB_VERSION_CACHE() {
    return getWhatsAppWebVersionCache();
  },
  WHATSAPP_PUPPETEER_ARGS,
  readWhatsAppRuntimePackageVersions,
  buildWhatsAppPuppeteerOptions,
  buildWhatsAppWebClientOptions,
  formatWhatsAppRuntimeConfigSummary,
  resolveBrowserExecutableCandidates,
  resolveBrowserExecutable,
  resolveWhatsAppWebVersionCacheDir,
  getWhatsAppWebVersionCache,
};
