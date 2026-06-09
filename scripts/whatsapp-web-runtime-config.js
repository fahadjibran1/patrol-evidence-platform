const { existsSync, readFileSync } = require('fs');
const path = require('path');

const WHATSAPP_WEB_VERSION =
  process.env.PATROL_WHATSAPP_WEB_VERSION?.trim() || '2.3000.1039703269-alpha';

const WHATSAPP_WEB_VERSION_CACHE = {
  type: 'remote',
  remotePath:
    process.env.PATROL_WHATSAPP_WEB_VERSION_CACHE_URL?.trim() ||
    'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
  strict: process.env.PATROL_WHATSAPP_WEB_VERSION_STRICT === 'true',
};

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
    webVersionCache: WHATSAPP_WEB_VERSION_CACHE,
    puppeteer: buildWhatsAppPuppeteerOptions({ headless, executablePath }),
  };
}

function formatWhatsAppRuntimeConfigSummary() {
  const versions = readWhatsAppRuntimePackageVersions();
  return [
    `wwebjs=${versions.whatsappWebJs}`,
    `puppeteer=${versions.puppeteer}`,
    `puppeteerCore=${versions.puppeteerCore}`,
    `webVersion=${WHATSAPP_WEB_VERSION}`,
    `webVersionCache=${WHATSAPP_WEB_VERSION_CACHE.type}`,
    `webVersionCacheStrict=${WHATSAPP_WEB_VERSION_CACHE.strict}`,
  ].join(' ');
}

module.exports = {
  WHATSAPP_WEB_VERSION,
  WHATSAPP_WEB_VERSION_CACHE,
  WHATSAPP_PUPPETEER_ARGS,
  readWhatsAppRuntimePackageVersions,
  buildWhatsAppPuppeteerOptions,
  buildWhatsAppWebClientOptions,
  formatWhatsAppRuntimeConfigSummary,
  resolveBrowserExecutableCandidates,
  resolveBrowserExecutable,
};
