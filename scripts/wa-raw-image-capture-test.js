/**
 * Standalone raw WhatsApp image capture — no backend, DB, or UI.
 *
 * Usage (repo root):
 *   npm run test:wa-raw-capture
 *
 * Optional env:
 *   WA_RAW_CAPTURE_ROOT     - default D:\Patrol_Evidence\RAW_TEST
 *   WA_TEST_BROWSER_PATH    - Edge/Chrome executable
 *   WA_TEST_SESSION_PATH    - LocalAuth data dir
 *   PATROL_WHATSAPP_WEB_VERSION / PATROL_WHATSAPP_WEB_VERSION_STRICT
 *   WA_TEST_HEADLESS=true
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const {
  buildWhatsAppWebClientOptions,
  formatWhatsAppRuntimeConfigSummary,
  resolveBrowserExecutable,
  WHATSAPP_WEB_VERSION,
} = require('./whatsapp-web-runtime-config');

const OUTPUT_ROOT =
  process.env.WA_RAW_CAPTURE_ROOT?.trim() || 'D:\\Patrol_Evidence\\RAW_TEST';
const SESSION_PATH =
  process.env.WA_TEST_SESSION_PATH?.trim() ||
  path.join(process.cwd(), 'whatsapp-session-raw-capture-test');
const HEADLESS = process.env.WA_TEST_HEADLESS === 'true';
const READY_TIMEOUT_MS = 180_000;
const NAVIGATION_REATTACH_DELAY_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const LOG_PATH = path.join(os.tmpdir(), 'wa-raw-image-capture-test.log');

const processedMessageIds = new Set();

let clientRef = null;
let isReady = false;
let listenersAttached = false;
let pageDiagnosticsAttached = false;
let navigationReattachTimer = null;
let heartbeatInterval = null;
let shuttingDown = false;

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

function ensureLogFileInitialized() {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, '', 'utf8');
  }
}

function appendLogLine(line) {
  ensureLogFileInitialized();
  fs.appendFileSync(LOG_PATH, `${line}\n`, 'utf8');
}

function log(event, details = '') {
  const line = `[${new Date().toISOString()}] ${event}${details ? ` ${details}` : ''}`;
  console.log(line);
  appendLogLine(line);
}

function emitCapture(line) {
  console.log(line);
  appendLogLine(line);
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function isRecoverableContextError(error) {
  const message = formatError(error).toLowerCase();
  return (
    message.includes('execution context was destroyed') ||
    message.includes('context was destroyed') ||
    message.includes('target closed') ||
    message.includes('session closed') ||
    message.includes('protocol error') ||
    message.includes('navigation')
  );
}

function isFatalError(error) {
  if (isRecoverableContextError(error)) {
    return false;
  }

  const message = formatError(error).toLowerCase();
  return (
    message.includes('no browser executable found') ||
    message.includes('auth_failure') ||
    message.includes('timed out waiting for ready')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (message.id?.remote?.endsWith('@g.us')) {
    return message.id.remote;
  }
  if (message.id?.remote?.endsWith('@c.us')) {
    return message.id.remote;
  }
  if (!message.fromMe && message.from?.endsWith('@c.us')) {
    return message.from;
  }
  if (message.fromMe && message.to?.endsWith('@c.us')) {
    return message.to;
  }
  return message.from ?? message.to ?? message.id?.remote ?? 'unknown';
}

function isGroupOrContactChat(chatId) {
  return typeof chatId === 'string' && (chatId.endsWith('@g.us') || chatId.endsWith('@c.us'));
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

function formatHourFolder(date) {
  const hour = String(date.getHours()).padStart(2, '0');
  return `${hour}00`;
}

function formatDateFolder(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveOutputDirectory(receivedAt) {
  const dateFolder = formatDateFolder(receivedAt);
  const hourFolder = formatHourFolder(receivedAt);
  return path.join(OUTPUT_ROOT, dateFolder, hourFolder);
}

async function resolveSenderDetails(message) {
  const chatId = getChatId(message);
  let senderId = message.author ?? message.from ?? 'unknown';
  let senderName = message._data?.notifyName ?? message._data?.pushname ?? '';

  if (!senderName && typeof message.getContact === 'function') {
    try {
      const contact = await message.getContact();
      senderName = contact?.pushname ?? contact?.name ?? contact?.shortName ?? '';
      if (!message.author && contact?.id?._serialized) {
        senderId = contact.id._serialized;
      }
    } catch (error) {
      if (!isRecoverableContextError(error)) {
        log('sender-contact-lookup-error', formatError(error));
      }
    }
  }

  if (message.fromMe) {
    senderId = message.from ?? senderId;
    senderName = senderName || 'me';
  }

  return {
    chatId,
    senderId,
    senderName: senderName || senderId,
  };
}

function isImageMessage(message) {
  if (!message?.hasMedia) {
    return false;
  }

  const type = String(message.type ?? '').toLowerCase();
  if (type === 'image' || type === 'sticker') {
    return true;
  }

  const mimetype = String(message._data?.mimetype ?? '').toLowerCase();
  return mimetype.startsWith('image/');
}

async function saveRawImage(message) {
  const messageId = getMessageId(message);
  if (processedMessageIds.has(messageId)) {
    return;
  }

  if (!isImageMessage(message)) {
    return;
  }

  const chatId = getChatId(message);
  if (!isGroupOrContactChat(chatId)) {
    return;
  }

  processedMessageIds.add(messageId);

  const receivedAt =
    message.timestamp != null ? new Date(message.timestamp * 1000) : new Date();

  const media = await message.downloadMedia();
  if (!media?.data) {
    log('RAW_IMAGE_DOWNLOAD_EMPTY', `id=${messageId} chat=${chatId}`);
    processedMessageIds.delete(messageId);
    return;
  }

  const outputDir = resolveOutputDirectory(receivedAt);
  fs.mkdirSync(outputDir, { recursive: true });

  const ext = extensionForMimetype(media.mimetype);
  const safeId = messageId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const filename = `${receivedAt.getTime()}-${safeId}.${ext}`;
  const outputPath = path.join(outputDir, filename);

  fs.writeFileSync(outputPath, Buffer.from(media.data, 'base64'));

  const { senderId, senderName } = await resolveSenderDetails(message);

  emitCapture(
    `RAW_IMAGE_CAPTURED sender=${senderId} senderName=${senderName} chat=${chatId} file=${outputPath}`,
  );
}

async function handleIncomingMessage(message, eventName) {
  try {
    await saveRawImage(message);
  } catch (error) {
    log(
      'RAW_IMAGE_ERROR',
      `event=${eventName} id=${getMessageId(message)} error=${formatError(error)}`,
    );
    processedMessageIds.delete(getMessageId(message));

    if (isRecoverableContextError(error)) {
      scheduleReattachAfterNavigation('message-handler', 'recoverable-error');
    }
  }
}

function onClientMessage(message) {
  void handleIncomingMessage(message, 'message');
}

function onClientMessageCreate(message) {
  void handleIncomingMessage(message, 'message_create');
}

function onClientMediaUploaded(message) {
  void handleIncomingMessage(message, 'media_uploaded');
}

function getListenerCounts(client) {
  if (!client) {
    return { message: 0, message_create: 0, media_uploaded: 0 };
  }

  return {
    message: client.listenerCount('message'),
    message_create: client.listenerCount('message_create'),
    media_uploaded: client.listenerCount('media_uploaded'),
  };
}

function formatListenerCounts(counts) {
  return `message=${counts.message} message_create=${counts.message_create} media_uploaded=${counts.media_uploaded}`;
}

function detachImageListeners(client) {
  if (!client) {
    listenersAttached = false;
    return;
  }

  client.removeListener('message', onClientMessage);
  client.removeListener('message_create', onClientMessageCreate);
  client.removeListener('media_uploaded', onClientMediaUploaded);
  listenersAttached = false;
}

function attachImageListeners(client, reason) {
  if (!client || !isReady) {
    return;
  }

  detachImageListeners(client);

  client.on('message', onClientMessage);
  client.on('message_create', onClientMessageCreate);
  client.on('media_uploaded', onClientMediaUploaded);
  listenersAttached = true;

  const counts = getListenerCounts(client);
  log('listeners-attached', `reason=${reason} ${formatListenerCounts(counts)}`);
}

function clearNavigationReattachTimer() {
  if (navigationReattachTimer) {
    clearTimeout(navigationReattachTimer);
    navigationReattachTimer = null;
  }
}

function scheduleReattachAfterNavigation(urlOrTrigger, reason) {
  if (!isReady || !clientRef || shuttingDown) {
    return;
  }

  log('navigation-after-ready', `trigger=${urlOrTrigger} reason=${reason}`);
  clearNavigationReattachTimer();

  navigationReattachTimer = setTimeout(() => {
    navigationReattachTimer = null;
    if (!isReady || !clientRef || shuttingDown) {
      return;
    }

    attachImageListeners(clientRef, 'navigation-reattach');
    log('listeners-reattached', `afterNavigation reason=${reason}`);
  }, NAVIGATION_REATTACH_DELAY_MS);
}

function describeFrameNavigation(frame) {
  try {
    return frame.navigationType?.() ?? 'navigated';
  } catch {
    return 'navigated';
  }
}

function attachPageDiagnostics(client) {
  const page = client?.pupPage;
  if (!page || pageDiagnosticsAttached) {
    return;
  }

  pageDiagnosticsAttached = true;
  log('page-diagnostics-attached', `url=${page.url()}`);

  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) {
      return;
    }

    const url = frame.url();
    const reason = describeFrameNavigation(frame);
    log('page-framenavigated', `url=${url} reason=${reason}`);

    if (isReady) {
      scheduleReattachAfterNavigation(url, reason);
    }
  });

  page.on('load', () => {
    log('page-load', `url=${page.url()}`);
    if (isReady) {
      scheduleReattachAfterNavigation(page.url(), 'load');
    }
  });

  page.on('domcontentloaded', () => {
    log('page-domcontentloaded', `url=${page.url()}`);
  });

  page.on('close', () => {
    log('page-close', `url=${page.url()}`);
  });

  page.on('error', (error) => {
    log('page-error', formatError(error));
    if (isReady && isRecoverableContextError(error)) {
      scheduleReattachAfterNavigation(page.url(), 'page-error');
    }
  });

  page.on('pageerror', (error) => {
    log('page-pageerror', formatError(error));
  });
}

function startHeartbeat(client) {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  heartbeatInterval = setInterval(() => {
    const counts = getListenerCounts(client);
    log(
      'RAW_CAPTURE_ALIVE',
      `ready=${isReady} listenersAttached=${listenersAttached} listenerCounts=${formatListenerCounts(counts)}`,
    );

    if (isReady && client) {
      const missing =
        counts.message === 0 || counts.message_create === 0 || counts.media_uploaded === 0;
      if (!listenersAttached || missing) {
        attachImageListeners(client, 'heartbeat-recovery');
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

async function printQr(qr) {
  log('qr-received', `length=${qr.length} scan with WhatsApp linked devices`);
  try {
    const qrcode = require('qrcode-terminal');
    qrcode.generate(qr, { small: true });
  } catch {
    console.log(qr);
  }
}

async function initializeClientSafely(client) {
  try {
    await client.initialize();
  } catch (error) {
    if (isRecoverableContextError(error)) {
      log('initialize-recoverable-error', formatError(error));
      await sleep(NAVIGATION_REATTACH_DELAY_MS);
      await client.initialize();
      return;
    }
    throw error;
  }
}

function installGlobalErrorHandlers() {
  process.on('unhandledRejection', (reason) => {
    const details = formatError(reason);
    if (isRecoverableContextError(reason)) {
      log('recoverable-unhandled-rejection', details);
      scheduleReattachAfterNavigation('unhandledRejection', 'execution-context');
      return;
    }

    log('unhandled-rejection', details);
    if (isFatalError(reason)) {
      log('fatal-unhandled-rejection', 'exiting');
      process.exit(1);
    }
  });

  process.on('uncaughtException', (error) => {
    const details = formatError(error);
    if (isRecoverableContextError(error)) {
      log('recoverable-uncaught-exception', details);
      scheduleReattachAfterNavigation('uncaughtException', 'execution-context');
      return;
    }

    log('uncaught-exception', details);
    if (isFatalError(error)) {
      log('fatal-uncaught-exception', 'exiting');
      process.exit(1);
    }
  });
}

async function main() {
  installGlobalErrorHandlers();
  ensureLogFileInitialized();
  appendLogLine(`--- raw capture started ${new Date().toISOString()} ---`);
  log('log-file', LOG_PATH);

  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

  const executablePath = resolveBrowserExecutable();
  log(
    'raw-capture-start',
    `browser=${executablePath} sessionPath=${SESSION_PATH} outputRoot=${OUTPUT_ROOT} webVersion=${WHATSAPP_WEB_VERSION}`,
  );
  log('whatsapp-runtime-packages', formatWhatsAppRuntimeConfigSummary());

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'wa-raw-image-capture-test',
      dataPath: SESSION_PATH,
    }),
    ...buildWhatsAppWebClientOptions({
      headless: HEADLESS,
      executablePath,
    }),
  });

  clientRef = client;

  client.on('qr', (qr) => {
    void printQr(qr);
  });

  client.on('authenticated', () => {
    log('authenticated');
    attachPageDiagnostics(client);
  });

  client.on('auth_failure', (message) => {
    log('auth-failure', String(message));
  });

  client.on('disconnected', (reason) => {
    log('disconnected', String(reason));
    isReady = false;
    listenersAttached = false;
  });

  const readyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ready after ${READY_TIMEOUT_MS}ms`));
    }, READY_TIMEOUT_MS);

    client.once('ready', () => {
      clearTimeout(timeout);
      isReady = true;
      log('ready', `account=${client.info?.wid?._serialized ?? 'unknown'}`);
      attachPageDiagnostics(client);
      attachImageListeners(client, 'ready');
      startHeartbeat(client);
      log(
        'listening',
        `Send a real image to any group or contact. Files save under ${OUTPUT_ROOT}\\<YYYY-MM-DD>\\<HH00>\\`,
      );
      resolve();
    });

    client.once('auth_failure', (message) => {
      clearTimeout(timeout);
      reject(new Error(`auth_failure: ${message}`));
    });
  });

  log('initializing');
  await initializeClientSafely(client);
  attachPageDiagnostics(client);
  log('waiting-for-ready');
  await readyPromise;

  await new Promise(() => {});
}

process.on('SIGINT', () => {
  shuttingDown = true;
  clearNavigationReattachTimer();
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  log('sigint', 'exiting');
  process.exit(0);
});

void main().catch((error) => {
  log('raw-capture-failed', formatError(error));
  if (isFatalError(error)) {
    process.exit(1);
  }
  log('raw-capture-continuing', 'non-fatal startup error; process kept alive for inspection');
});
