import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';

const requireFromHere = createRequire(__filename);

export const WHATSAPP_PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
] as const;

export const WHATSAPP_WEB_VERSION =
  process.env.PATROL_WHATSAPP_WEB_VERSION?.trim() || '2.3000.1039703269-alpha';

export const WHATSAPP_WEB_VERSION_CACHE = {
  type: 'remote' as const,
  remotePath:
    process.env.PATROL_WHATSAPP_WEB_VERSION_CACHE_URL?.trim() ||
    'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
  strict: process.env.PATROL_WHATSAPP_WEB_VERSION_STRICT === 'true',
};

export interface WhatsAppRuntimePackageVersions {
  whatsappWebJs: string;
  puppeteer: string;
  puppeteerCore: string;
}

export function readWhatsAppRuntimePackageVersions(): WhatsAppRuntimePackageVersions {
  const readVersion = (packageName: string): string => {
    try {
      const packageJsonPath = requireFromHere.resolve(`${packageName}/package.json`);
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string };
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

export function buildWhatsAppPuppeteerOptions(input: {
  headless: boolean;
  executablePath: string;
  dumpio?: boolean;
}): {
  headless: boolean;
  executablePath: string;
  dumpio: boolean;
  args: string[];
} {
  return {
    headless: input.headless,
    executablePath: input.executablePath,
    dumpio: input.dumpio ?? false,
    args: [...WHATSAPP_PUPPETEER_ARGS],
  };
}

export interface ResolvedBrowserExecutable {
  executablePath: string;
  source: 'configured' | 'edge' | 'chrome';
}

export function resolveBrowserExecutableCandidates(): string[] {
  const configured =
    process.env.PATROL_HELPER_EDGE_PATH?.trim() ||
    process.env.PATROL_HELPER_CHROME_PATH?.trim() ||
    process.env.WA_TEST_BROWSER_PATH?.trim() ||
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

export function resolveBrowserExecutables(): {
  available: ResolvedBrowserExecutable[];
  tried: string[];
} {
  const tried: string[] = [];
  const available: ResolvedBrowserExecutable[] = [];
  const seen = new Set<string>();

  for (const candidate of resolveBrowserExecutableCandidates()) {
    const normalized = path.normalize(candidate);
    if (seen.has(normalized.toLowerCase())) {
      continue;
    }

    seen.add(normalized.toLowerCase());
    tried.push(normalized);

    if (!existsSync(normalized)) {
      continue;
    }

    available.push({
      executablePath: normalized,
      source: /\\msedge\.exe$/i.test(normalized) ? 'edge' : 'chrome',
    });
  }

  return { available, tried };
}

export function buildWhatsAppLaunchConfigSummary(input: {
  executablePath: string;
  browserSource: string;
  headless: boolean;
  sessionPath: string;
  userDataDir: string;
  clientId: string;
}): string {
  const puppeteer = buildWhatsAppPuppeteerOptions({
    headless: input.headless,
    executablePath: input.executablePath,
  });

  return [
    `executablePath=${input.executablePath}`,
    `browserSource=${input.browserSource}`,
    `userDataDir=${input.userDataDir}`,
    `sessionPath=${input.sessionPath}`,
    `clientId=${input.clientId}`,
    `headless=${String(puppeteer.headless)}`,
    `args=${puppeteer.args.join(' ')}`,
    `dumpio=${String(puppeteer.dumpio)}`,
    `platform=${os.platform()}`,
  ].join(' ');
}

export function buildWhatsAppWebClientOptions(input: {
  headless: boolean;
  executablePath: string;
  dumpio?: boolean;
}): {
  webVersion: string;
  webVersionCache: typeof WHATSAPP_WEB_VERSION_CACHE;
  puppeteer: ReturnType<typeof buildWhatsAppPuppeteerOptions>;
} {
  return {
    webVersion: WHATSAPP_WEB_VERSION,
    webVersionCache: WHATSAPP_WEB_VERSION_CACHE,
    puppeteer: buildWhatsAppPuppeteerOptions(input),
  };
}

export function formatWhatsAppRuntimeConfigSummary(): string {
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
