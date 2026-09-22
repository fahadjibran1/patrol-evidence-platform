const path = require('path');

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'postgresql.org',
  'www.postgresql.org',
  'techguardsecurity.com',
  'www.techguardsecurity.com',
  'techguards.co.uk',
  'www.techguards.co.uk',
  'sfour.co.uk',
  'www.sfour.co.uk',
]);
const ALLOWED_MAIL_DOMAINS = new Set(['techguardsecurity.com', 'techguards.co.uk', 'sfour.co.uk']);
const ALLOWED_SECURE_STORE_KEYS = new Set(['desktop-auth-session', 'commercial-purchase-session']);
const ALLOWED_CONFIG_KEYS = new Set([
  'workspaceName', 'companyName', 'localAdminEmail', 'localAdminFirstName', 'localAdminLastName',
  'storageRootPath', 'autoLaunchApp', 'autoStartCollector', 'whatsappAllowFromMe', 'setupCompleted', 'setupStage',
  'appTimeZone',
  'dbType', 'sqliteDbPath', 'dbHost', 'dbPort', 'dbUser', 'dbPassword', 'dbName',
]);
const ALLOWED_POSTGRES_KEYS = new Set(['dbHost', 'dbPort', 'dbUser', 'dbPassword', 'dbName']);

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object.`);
  }
}

function assertTrustedIpcSender(event, mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed() || event?.sender !== mainWindow.webContents ||
      event?.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Untrusted renderer IPC request rejected.');
  }
}

function validateExternalUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('External URL is invalid.');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('External URL is invalid.'); }
  if (parsed.username || parsed.password) throw new Error('External URL credentials are not allowed.');
  if (parsed.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())) return parsed.toString();
  if (parsed.protocol === 'mailto:') {
    const address = decodeURIComponent(parsed.pathname).trim().toLowerCase();
    const domain = address.includes('@') ? address.split('@').pop() : '';
    if (domain && ALLOWED_MAIL_DOMAINS.has(domain)) return parsed.toString();
  }
  throw new Error('This external destination is not allowed.');
}

function validateCommercialPurchaseUrl(value, approvedOrigin) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Commercial purchase URL is invalid.');
  let target;
  let approved;
  try {
    target = new URL(value);
    approved = new URL(approvedOrigin);
  } catch {
    throw new Error('Commercial purchase URL is invalid.');
  }
  if (approved.protocol !== 'https:' || approved.username || approved.password || approved.search || approved.hash || approved.pathname !== '/') {
    throw new Error('Approved commercial purchase origin is invalid.');
  }
  if (target.protocol !== 'https:' || target.origin !== approved.origin || target.username || target.password) {
    throw new Error('Commercial purchase destination is not allowed.');
  }
  if (!/^\/patrolsafe\/buy\/[A-Za-z0-9_-]{43}$/.test(target.pathname) || target.search || target.hash) {
    throw new Error('Commercial purchase URL is invalid.');
  }
  return target.toString();
}

function isTrustedRendererNavigation(value, { packagedEntryUrl, developmentUrl }) {
  let target;
  try { target = new URL(value); } catch { return false; }

  if (target.protocol === 'file:' && packagedEntryUrl) {
    const entry = new URL(packagedEntryUrl);
    return target.protocol === entry.protocol && decodeURIComponent(target.pathname) === decodeURIComponent(entry.pathname);
  }

  if ((target.protocol === 'http:' || target.protocol === 'https:') && developmentUrl) {
    const development = new URL(developmentUrl);
    return target.origin === development.origin && target.pathname === development.pathname;
  }

  return false;
}

function isPathInside(parentDirectory, candidatePath) {
  const relative = path.relative(path.resolve(parentDirectory), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateOpenPath(value, allowedRoots) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('Path is invalid.');
  const resolved = path.resolve(value);
  if (!allowedRoots.filter(Boolean).some((root) => isPathInside(root, resolved))) {
    throw new Error('Path is outside PatrolSafe managed storage.');
  }
  return resolved;
}

function sanitizeObject(value, allowedKeys, label) {
  assertPlainObject(value, label);
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${label} contains an unsupported field.`);
    if (typeof entry === 'string' && entry.length > 4096) throw new Error(`${label} contains an oversized value.`);
    if (!['string', 'number', 'boolean'].includes(typeof entry) && entry !== null && entry !== undefined) {
      throw new Error(`${label} contains an unsupported value.`);
    }
    result[key] = entry;
  }
  return result;
}

function normalizeIanaTimeZone(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 128) {
    return null;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.trim() }).format(0);
    return value.trim();
  } catch {
    return null;
  }
}

const sanitizeDesktopConfigPatch = (value) => {
  const result = sanitizeObject(value, ALLOWED_CONFIG_KEYS, 'Desktop configuration');
  if (Object.prototype.hasOwnProperty.call(result, 'appTimeZone')) {
    const normalized = normalizeIanaTimeZone(result.appTimeZone);
    if (!normalized) throw new Error('Choose a valid time zone from the list.');
    result.appTimeZone = normalized;
  }
  return result;
};
const sanitizePostgresConfig = (value) => sanitizeObject(value, ALLOWED_POSTGRES_KEYS, 'Database configuration');

function validateSecureStoreKey(value) {
  if (typeof value !== 'string' || !ALLOWED_SECURE_STORE_KEYS.has(value)) throw new Error('Secure storage key is not allowed.');
  return value;
}

function validateSecureStoreValue(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 64 * 1024) throw new Error('Secure storage value is invalid.');
  return value;
}

function productionDevToolsAllowed({ packaged, appDebug, supportMode }) {
  return packaged ? appDebug === true && supportMode === true : appDebug === true;
}

module.exports = {
  assertTrustedIpcSender,
  productionDevToolsAllowed,
  isTrustedRendererNavigation,
  normalizeIanaTimeZone,
  sanitizeDesktopConfigPatch,
  sanitizePostgresConfig,
  validateExternalUrl,
  validateCommercialPurchaseUrl,
  validateOpenPath,
  validateSecureStoreKey,
  validateSecureStoreValue,
};
