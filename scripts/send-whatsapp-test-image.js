const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const GROUP_ID = '120363375746387624@g.us';
const SESSION_PATH = process.env.WHATSAPP_SESSION_PATH?.trim() || path.join(process.cwd(), 'whatsapp-session');
const CHROME_PATH = process.env.WHATSAPP_CHROME_PATH?.trim() || '';
const HEADLESS = process.env.WHATSAPP_HEADLESS === 'true';
const TEST_IMAGE_PATH = path.join(os.tmpdir(), 'patrol-evidence-platform', 'whatsapp-test-image.png');

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

function resolveChromePath() {
  const candidates = [
    CHROME_PATH,
    path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('No Chrome executable found for WhatsApp test send.');
}

function ensureTestImage() {
  fs.mkdirSync(path.dirname(TEST_IMAGE_PATH), { recursive: true });
  if (!fs.existsSync(TEST_IMAGE_PATH)) {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';
    fs.writeFileSync(TEST_IMAGE_PATH, Buffer.from(pngBase64, 'base64'));
  }

  return TEST_IMAGE_PATH;
}

async function main() {
  const executablePath = resolveChromePath();
  const imagePath = ensureTestImage();
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'patrol-evidence-platform',
      dataPath: SESSION_PATH,
    }),
    puppeteer: {
      headless: HEADLESS,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-crash-reporter',
        '--disable-breakpad',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
      ],
    },
  });

  const readyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for WhatsApp ready.')), 120_000);
    client.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });
    client.once('auth_failure', (message) => {
      clearTimeout(timeout);
      reject(new Error(`WhatsApp auth failure: ${message}`));
    });
  });

  console.log(`WHATSAPP_TEST_SEND_START group=${GROUP_ID} sessionPath=${SESSION_PATH}`);
  await client.initialize();
  await readyPromise;

  const media = MessageMedia.fromFilePath(imagePath);
  const sent = await client.sendMessage(GROUP_ID, media, { caption: `patrol-import-test ${new Date().toISOString()}` });
  console.log(`WHATSAPP_TEST_SEND_OK messageId=${sent.id?._serialized ?? 'unknown'} imagePath=${imagePath}`);

  await client.destroy();
}

void main().catch((error) => {
  console.error(`WHATSAPP_TEST_SEND_FAILED ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
