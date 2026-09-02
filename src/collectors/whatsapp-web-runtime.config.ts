import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const requireFromHere = createRequire(__filename);

export const WHATSAPP_PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
] as const;

/**
 * Pinned WhatsApp Web HTML used with whatsapp-web.js 1.34.7 when mode=pinned.
 * Must exist as a local cache file — remote pins disappear from wppconnect/wa-version
 * and non-strict remote cache returns null, which loads live WA Web and breaks Store/WWebJS.
 */
export const WHATSAPP_WEB_VERSION =
  process.env.PATROL_WHATSAPP_WEB_VERSION?.trim() || '2.3000.1040111714-alpha';

/**
 * pinned          = local HTML pin only (fail closed, never silent live fallback) — Test C
 * live            = current WhatsApp Web via webVersionCache type none — Test B
 * library-default = whatsapp-web.js DefaultOptions local cache strict:false — Test A
 */
export type WhatsAppWebVersionMode = 'pinned' | 'live' | 'library-default';
export type WhatsAppBrowserPreference = 'auto' | 'chrome' | 'edge';

export type WhatsAppWebVersionCacheConfig =
  | {
      type: 'local';
      path: string;
      strict: boolean;
    }
  | {
      type: 'remote';
      remotePath: string;
      strict: boolean;
    }
  | {
      type: 'none';
      strict: true;
    };

function candidateWhatsAppWebVersionCacheDirs(): string[] {
  const fromEnv = process.env.PATROL_WHATSAPP_WEB_VERSION_CACHE_PATH?.trim();
  const resourcesPath = process.env.PATROL_RESOURCES_PATH?.trim();
  const appPath = process.env.PATROL_APP_PATH?.trim();

  return [
    fromEnv,
    path.join(__dirname, 'wa-web-cache'),
    resourcesPath ? path.join(resourcesPath, 'wa-web-cache') : null,
    resourcesPath ? path.join(resourcesPath, 'whatsapp-web-cache') : null,
    appPath ? path.join(appPath, 'resources', 'wa-web-cache') : null,
    appPath ? path.join(appPath, 'resources', 'whatsapp-web-cache') : null,
    path.join(process.cwd(), 'dist', 'collectors', 'wa-web-cache'),
    path.join(process.cwd(), 'src', 'collectors', 'wa-web-cache'),
    path.join(process.cwd(), 'resources', 'whatsapp-web-cache'),
    path.join(process.cwd(), 'resources', 'wa-web-cache'),
    path.join(process.cwd(), '..', 'wa-web-cache'),
    path.join(process.cwd(), '..', 'whatsapp-web-cache'),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export function resolveWhatsAppWebVersionCacheDir(): string | null {
  const versionFile = `${WHATSAPP_WEB_VERSION}.html`;
  for (const candidate of candidateWhatsAppWebVersionCacheDirs()) {
    if (existsSync(path.join(candidate, versionFile))) {
      return candidate;
    }
  }
  return null;
}

export function resolvePinnedWhatsAppWebHtmlPath(): string | null {
  const cacheDir = resolveWhatsAppWebVersionCacheDir();
  if (!cacheDir) {
    return null;
  }
  const htmlPath = path.join(cacheDir, `${WHATSAPP_WEB_VERSION}.html`);
  return existsSync(htmlPath) ? htmlPath : null;
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * pinned = local HTML pin only (fail closed, never silent live fallback)
 * live   = current WhatsApp Web runtime via webVersionCache type=none (overrides library defaults)
 * library-default = Test A: no explicit webVersion override beyond library DefaultOptions
 */
export function resolveWhatsAppWebVersionMode(): WhatsAppWebVersionMode {
  const raw = (
    process.env.PATROL_WHATSAPP_WEB_VERSION_MODE?.trim() ||
    process.env.WHATSAPP_WEB_VERSION_MODE?.trim() ||
    // Production default: known-compatible local pin (Test C). Never silently fall back to live.
    'pinned'
  ).toLowerCase();

  if (raw === 'live' || raw === 'current' || raw === 'unpinned' || raw === 'test-b') {
    return 'live';
  }

  if (
    raw === 'library-default' ||
    raw === 'library_default' ||
    raw === 'default' ||
    raw === 'test-a'
  ) {
    return 'library-default';
  }

  if (raw === 'pinned' || raw === 'local' || raw === 'test-c') {
    return 'pinned';
  }

  throw new Error(
    `Invalid WhatsApp Web version mode "${raw}". Use pinned, live, or library-default (PATROL_WHATSAPP_WEB_VERSION_MODE).`,
  );
}

function resolveWhatsAppWebVersionCache(): WhatsAppWebVersionCacheConfig {
  const mode = resolveWhatsAppWebVersionMode();

  if (mode === 'live') {
    return { type: 'none', strict: true };
  }

  if (mode === 'library-default') {
    // Mirrors whatsapp-web.js DefaultOptions: local cache, strict:false, no custom path.
    return {
      type: 'local',
      path: path.join(process.cwd(), '.wwebjs_cache'),
      strict: false,
    };
  }

  const forceRemote = process.env.PATROL_WHATSAPP_WEB_VERSION_CACHE_TYPE?.trim() === 'remote';
  if (forceRemote) {
    return {
      type: 'remote',
      remotePath:
        process.env.PATROL_WHATSAPP_WEB_VERSION_CACHE_URL?.trim() ||
        'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
      // Fail closed — never silently fall back to a different version.
      strict: true,
    };
  }

  const localPath = resolveWhatsAppWebVersionCacheDir();
  if (!localPath) {
    throw new Error(
      `WhatsApp Web version cache missing for ${WHATSAPP_WEB_VERSION}. ` +
        `Expected ${WHATSAPP_WEB_VERSION}.html under dist/collectors/wa-web-cache or resources/wa-web-cache. ` +
        `Set PATROL_WHATSAPP_WEB_VERSION_CACHE_PATH, or set PATROL_WHATSAPP_WEB_VERSION_MODE=live to use the current WA Web runtime.`,
    );
  }

  return {
    type: 'local',
    path: localPath,
    strict: true,
  };
}

export function getWhatsAppWebVersionCache(): WhatsAppWebVersionCacheConfig {
  return resolveWhatsAppWebVersionCache();
}

/** Resolved at call time so packaged/dev cache paths can differ after nest asset copy. */
export const WHATSAPP_WEB_VERSION_CACHE: WhatsAppWebVersionCacheConfig = new Proxy(
  {} as WhatsAppWebVersionCacheConfig,
  {
    get(_target, property, receiver) {
      return Reflect.get(getWhatsAppWebVersionCache(), property, receiver);
    },
  },
);

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

function inferBrowserSourceFromPath(executablePath: string): 'edge' | 'chrome' | 'configured' {
  if (/msedge\.exe$/i.test(executablePath)) {
    return 'edge';
  }
  if (/chrome\.exe$/i.test(executablePath)) {
    return 'chrome';
  }
  return 'configured';
}

export function resolveWhatsAppBrowserPreference(): WhatsAppBrowserPreference {
  const raw = (
    process.env.WHATSAPP_BROWSER?.trim() ||
    process.env.PATROL_WHATSAPP_BROWSER?.trim() ||
    'auto'
  ).toLowerCase();

  if (raw === 'chrome' || raw === 'edge' || raw === 'auto') {
    return raw;
  }

  throw new Error(`Invalid WHATSAPP_BROWSER="${raw}". Use chrome, edge, or auto.`);
}

export function resolveBrowserExecutableCandidates(
  preference: WhatsAppBrowserPreference = resolveWhatsAppBrowserPreference(),
): string[] {
  const configuredEdge = process.env.PATROL_HELPER_EDGE_PATH?.trim() || '';
  const configuredChrome =
    process.env.PATROL_HELPER_CHROME_PATH?.trim() ||
    process.env.WA_TEST_BROWSER_PATH?.trim() ||
    process.env.WHATSAPP_CHROME_PATH?.trim() ||
    '';

  const edgeCandidates = [
    configuredEdge,
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  const chromeCandidates = [
    configuredChrome,
    path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);

  if (preference === 'chrome') {
    return chromeCandidates;
  }

  if (preference === 'edge') {
    return edgeCandidates;
  }

  // auto: prefer an explicitly configured Chrome path, then Chrome, then Edge.
  // Never prefer Edge when a Chrome path is configured.
  if (configuredChrome) {
    return [configuredChrome, ...chromeCandidates, ...edgeCandidates].filter(Boolean);
  }

  return [...chromeCandidates, ...edgeCandidates].filter(Boolean);
}

export function resolveBrowserExecutables(): {
  available: ResolvedBrowserExecutable[];
  tried: string[];
  preference: WhatsAppBrowserPreference;
} {
  const preference = resolveWhatsAppBrowserPreference();
  const tried: string[] = [];
  const available: ResolvedBrowserExecutable[] = [];
  const seen = new Set<string>();

  for (const candidate of resolveBrowserExecutableCandidates(preference)) {
    const normalized = path.normalize(candidate);
    if (seen.has(normalized.toLowerCase())) {
      continue;
    }

    seen.add(normalized.toLowerCase());
    tried.push(normalized);

    if (!existsSync(normalized)) {
      continue;
    }

    const inferred = inferBrowserSourceFromPath(normalized);
    const source: ResolvedBrowserExecutable['source'] =
      inferred === 'configured'
        ? preference === 'edge'
          ? 'edge'
          : preference === 'chrome'
            ? 'chrome'
            : 'configured'
        : inferred;

    // When forcing chrome/edge, only accept matching executables.
    if (preference === 'chrome' && source === 'edge') {
      continue;
    }
    if (preference === 'edge' && source === 'chrome') {
      continue;
    }

    available.push({
      executablePath: normalized,
      source,
    });
  }

  return { available, tried, preference };
}

export function readBrowserExecutableVersion(executablePath: string): string {
  if (!executablePath || !existsSync(executablePath)) {
    return 'unknown';
  }

  try {
    if (process.platform === 'win32') {
      const escaped = executablePath.replace(/'/g, "''");
      const output = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `(Get-Item -LiteralPath '${escaped}').VersionInfo.ProductVersion`,
        ],
        { encoding: 'utf8', timeout: 8_000, windowsHide: true },
      ).trim();
      return output || 'unknown';
    }

    const output = execFileSync(executablePath, ['--version'], {
      encoding: 'utf8',
      timeout: 8_000,
    }).trim();
    return output || 'unknown';
  } catch {
    return 'unknown';
  }
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
    `whatsappBrowser=${resolveWhatsAppBrowserPreference()}`,
    `browserVersion=${readBrowserExecutableVersion(input.executablePath)}`,
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
  webVersion?: string;
  webVersionCache?: WhatsAppWebVersionCacheConfig;
  puppeteer: ReturnType<typeof buildWhatsAppPuppeteerOptions>;
} {
  const mode = resolveWhatsAppWebVersionMode();
  const puppeteer = buildWhatsAppPuppeteerOptions(input);

  if (mode === 'live') {
    // Explicitly override library DefaultOptions local pin — no silent fallback.
    return {
      webVersionCache: { type: 'none', strict: true },
      puppeteer,
    };
  }

  if (mode === 'library-default') {
    // Test A: leave webVersion/webVersionCache unset so whatsapp-web.js DefaultOptions apply
    // (webVersion + local cache strict:false). Callers must not merge conflicting overrides.
    return { puppeteer };
  }

  const cache = getWhatsAppWebVersionCache();
  if (cache.type === 'none') {
    return {
      webVersionCache: cache,
      puppeteer,
    };
  }

  return {
    webVersion: WHATSAPP_WEB_VERSION,
    webVersionCache: cache,
    puppeteer,
  };
}

export interface WhatsAppWebVersionLogSnapshot {
  mode: WhatsAppWebVersionMode;
  requestedVersion: string;
  cacheMode: string;
  cacheStrict: string;
  htmlPath: string | null;
  htmlSha256: string | null;
  htmlExists: boolean;
}

export function getWhatsAppWebVersionLogSnapshot(): WhatsAppWebVersionLogSnapshot {
  const mode = resolveWhatsAppWebVersionMode();
  const cache = getWhatsAppWebVersionCache();
  const htmlPath = mode === 'pinned' ? resolvePinnedWhatsAppWebHtmlPath() : null;
  const htmlSha256 = htmlPath ? sha256File(htmlPath) : null;

  let requestedVersion = 'library-default-current';
  if (mode === 'pinned') {
    requestedVersion = WHATSAPP_WEB_VERSION;
  } else if (mode === 'library-default') {
    requestedVersion = '2.3000.1017054665'; // whatsapp-web.js DefaultOptions.webVersion
  } else {
    requestedVersion = 'live-unpinned';
  }

  return {
    mode,
    requestedVersion,
    cacheMode: cache.type,
    cacheStrict: cache.type === 'none' ? 'n/a' : String(cache.strict),
    htmlPath,
    htmlSha256,
    htmlExists: Boolean(htmlPath),
  };
}

export function formatWhatsAppRuntimeConfigSummary(): string {
  const versions = readWhatsAppRuntimePackageVersions();
  const snapshot = getWhatsAppWebVersionLogSnapshot();
  const cache = getWhatsAppWebVersionCache();
  const cachePath =
    cache.type === 'local' ? cache.path : cache.type === 'remote' ? cache.remotePath : 'none-live';
  return [
    `wwebjs=${versions.whatsappWebJs}`,
    `puppeteer=${versions.puppeteer}`,
    `puppeteerCore=${versions.puppeteerCore}`,
    `webVersionMode=${snapshot.mode}`,
    `webVersion=${snapshot.requestedVersion}`,
    `webVersionCache=${cache.type}`,
    `webVersionCachePath=${cachePath}`,
    `webVersionCacheStrict=${snapshot.cacheStrict}`,
    `webHtmlSha256=${snapshot.htmlSha256 ?? 'n/a'}`,
    `whatsappBrowser=${resolveWhatsAppBrowserPreference()}`,
  ].join(' ');
}
