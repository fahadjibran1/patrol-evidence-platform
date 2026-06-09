/**
 * Minimal isolated whatsapp-web.js live media event probe.
 * No backend, DB, patrol pipeline, or Electron.
 *
 * Usage (from repo root):
 *   node scripts/test-live-image-events.js
 *
 * Optional env:
 *   WA_TEST_BROWSER_PATH              - Edge/Chrome executable
 *   WA_TEST_SESSION_PATH              - LocalAuth data dir
 *   PATROL_WHATSAPP_WEB_VERSION       - pinned WA Web HTML version
 *   PATROL_WHATSAPP_WEB_VERSION_STRICT=true
 *   WA_TEST_HEADLESS=true             - headless browser (default: false)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const {
  buildWhatsAppWebClientOptions,
  formatWhatsAppRuntimeConfigSummary,
  WHATSAPP_WEB_VERSION,
} = require('./whatsapp-web-runtime-config');

const OUTPUT_DIR = 'C:\\temp\\wa-test-images';
const SESSION_PATH =
  process.env.WA_TEST_SESSION_PATH?.trim() ||
  path.join(process.cwd(), 'whatsapp-session-test-events');
const HEADLESS = process.env.WA_TEST_HEADLESS === 'true';
const READY_TIMEOUT_MS = 180_000;

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function log(event, details = '') {
  const line = `[${new Date().toISOString()}] ${event}${details ? ` ${details}` : ''}`;
  console.log(line);
}

function resolveBrowserExecutable() {
  const configured =
    process.env.WA_TEST_BROWSER_PATH?.trim() ||
    process.env.PATROL_HELPER_EDGE_PATH?.trim() ||
    process.env.PATROL_HELPER_CHROME_PATH?.trim() ||
    process.env.WHATSAPP_CHROME_PATH?.trim() ||
    '';

  const candidates = [
    configured,
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'No browser executable found. Set WA_TEST_BROWSER_PATH to msedge.exe or chrome.exe.',
  );
}

function getMessageId(message) {
  return message.id?._serialized ?? 'unknown';
}

function getChatId(message) {
  if (message.from?.endsWith('@g.us')) {
    return message.from;
  }
  if (message.to?.endsWith('@g.us')) {
    return message.to;
  }
  if (message.id?.remote) {
    return message.id.remote;
  }
  return message.from ?? message.to ?? 'unknown';
}

function extensionForMimetype(mimetype) {
  if (!mimetype) {
    return 'bin';
  }
  const normalized = mimetype.split(';')[0].trim().toLowerCase();
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return map[normalized] ?? normalized.split('/')[1] ?? 'bin';
}

async function logLoadedWhatsAppWebVersion(client, trigger) {
  try {
    const loadedVersion = await client.pupPage?.evaluate(() => {
      return window.Debug?.VERSION ?? 'unknown';
    });
    log('whatsapp-web-version-loaded', `trigger=${trigger} configured=${WHATSAPP_WEB_VERSION} loaded=${loadedVersion}`);
  } catch (error) {
    log(
      'whatsapp-web-version-loaded',
      `trigger=${trigger} configured=${WHATSAPP_WEB_VERSION} error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function logMediaListenerCounts(client, trigger) {
  log(
    'media-listener-counts',
    [
      `trigger=${trigger}`,
      `message=${client.listenerCount('message')}`,
      `message_create=${client.listenerCount('message_create')}`,
      `media_uploaded=${client.listenerCount('media_uploaded')}`,
    ].join(' '),
  );
}

async function saveMessageMedia(message, eventName) {
  const media = await message.downloadMedia();
  if (!media?.data) {
    log('media-download-empty', `event=${eventName} id=${getMessageId(message)}`);
    return null;
  }

  const ext = extensionForMimetype(media.mimetype);
  const safeId = getMessageId(message).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `${Date.now()}-${eventName}-${safeId}.${ext}`;
  const outputPath = path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(outputPath, Buffer.from(media.data, 'base64'));
  log('media-saved', `path=${outputPath} mimetype=${media.mimetype ?? 'unknown'}`);
  return outputPath;
}

async function handleMediaEvent(message, eventName) {
  const messageId = getMessageId(message);
  const chatId = getChatId(message);

  log(
    'live-event',
    [
      `event=${eventName}`,
      `id=${messageId}`,
      `hasMedia=${message.hasMedia}`,
      `fromMe=${message.fromMe}`,
      `type=${message.type ?? 'unknown'}`,
      `chat=${chatId}`,
    ].join(' '),
  );

  if (!message.hasMedia) {
    return;
  }

  try {
    await saveMessageMedia(message, eventName);
  } catch (error) {
    log(
      'media-download-error',
      `event=${eventName} id=${messageId} error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function attachLiveEventListeners(client) {
  client.on('message', (message) => {
    void handleMediaEvent(message, 'message');
  });
  client.on('message_create', (message) => {
    void handleMediaEvent(message, 'message_create');
  });
  client.on('media_uploaded', (message) => {
    void handleMediaEvent(message, 'media_uploaded');
  });

  log('listeners-attached', 'trigger=ready-event');
  logMediaListenerCounts(client, 'ready-event');
}

function attachPageDiagnostics(client) {
  const page = client.pupPage;
  if (!page) {
    return;
  }

  page.on('console', (message) => {
    const text = message.text();
    if (text.includes('Requiring unknown module')) {
      log('whatsapp-module-compat-warning', text);
      return;
    }
  });

  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) {
      return;
    }

    let reason = 'navigated';
    try {
      reason = frame.navigationType?.() ?? reason;
    } catch {
      // ignore
    }

    log('page-mainframe-navigated', `url=${frame.url()} reason=${reason}`);
    if (client.info) {
      logMediaListenerCounts(client, `navigation-${reason}`);
    }
  });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const executablePath = resolveBrowserExecutable();
  log('test-start', `browser=${executablePath} sessionPath=${SESSION_PATH} outputDir=${OUTPUT_DIR}`);
  log('whatsapp-runtime-packages', formatWhatsAppRuntimeConfigSummary());

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'wa-live-image-events-test',
      dataPath: SESSION_PATH,
    }),
    ...buildWhatsAppWebClientOptions({
      headless: HEADLESS,
      executablePath,
    }),
  });

  client.on('qr', (qr) => {
    log('qr-received', `length=${qr.length} scan with linked device or terminal QR renderer`);
    console.log(qr);
  });

  client.on('authenticated', () => {
    log('authenticated-event');
  });

  client.on('auth_failure', (message) => {
    log('auth-failure', String(message));
  });

  client.on('disconnected', (reason) => {
    log('disconnected', String(reason));
  });

  const readyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ready after ${READY_TIMEOUT_MS}ms`));
    }, READY_TIMEOUT_MS);

    client.once('ready', async () => {
      clearTimeout(timeout);
      log('ready-event', `account=${client.info?.wid?._serialized ?? 'unknown'}`);
      attachPageDiagnostics(client);
      attachLiveEventListeners(client);
      await logLoadedWhatsAppWebVersion(client, 'ready-event');
      log(
        'listening',
        'Send a real image to a group (e.g. 120363375746387624@g.us). Press Ctrl+C to exit.',
      );
      resolve();
    });

    client.once('auth_failure', (message) => {
      clearTimeout(timeout);
      reject(new Error(`auth_failure: ${message}`));
    });
  });

  log('initializing');
  await client.initialize();
  attachPageDiagnostics(client);
  log('waiting-for-ready');
  await readyPromise;
  await new Promise(() => {});
}

process.on('SIGINT', () => {
  log('sigint', 'exiting');
  process.exit(0);
});

void main().catch((error) => {
  log('test-failed', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
