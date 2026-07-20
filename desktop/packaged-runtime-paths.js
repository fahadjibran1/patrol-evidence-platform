const fs = require('fs');
const path = require('path');

/**
 * Canonical Nest desktop backend entry relative to the packaged app root
 * (resources/app when asar:false). Prefer the flat Nest emit; keep the
 * legacy nested emit as an explicit secondary candidate only.
 */
const BACKEND_ENTRY_RELATIVE_CANDIDATES = [
  path.join('dist', 'main.js'),
  path.join('dist', 'src', 'main.js'),
];

const FRONTEND_ENTRY_RELATIVE_CANDIDATES = [path.join('web', 'dist', 'index.html')];

const WHATSAPP_HELPER_RELATIVE_CANDIDATES = [
  path.join('dist', 'collectors', 'whatsapp-helper.main.js'),
  path.join('dist', 'src', 'collectors', 'whatsapp-helper.main.js'),
];

const LICENSE_PUBLIC_KEY_UTIL_RELATIVE_CANDIDATES = [
  path.join('dist', 'licensing', 'license-public-key.util.js'),
  path.join('dist', 'src', 'licensing', 'license-public-key.util.js'),
];

function normalizePath(candidatePath) {
  return path.normalize(String(candidatePath || ''));
}

function toPosixPath(candidatePath) {
  return normalizePath(candidatePath).replace(/\\/g, '/').toLowerCase();
}

/**
 * Reject accidental resolution into dependency trees or sibling apps.
 * Never pick an arbitrary main.js via recursive search.
 */
function isForbiddenRuntimePath(candidatePath) {
  const normalized = toPosixPath(candidatePath);
  return (
    normalized.includes('/node_modules/') ||
    normalized.includes('/apps/license-api/') ||
    normalized.includes('/apps/license-portal/') ||
    normalized.includes('/license-api/dist/') ||
    normalized.includes('/license-portal/dist/') ||
    normalized.includes('/apps/license-api') ||
    normalized.includes('/apps/license-portal')
  );
}

function getPackagedAppRoot({ resourcesPath, appRoot, dirnameHint } = {}) {
  if (resourcesPath) {
    return normalizePath(path.join(resourcesPath, 'app'));
  }

  if (appRoot) {
    return normalizePath(appRoot);
  }

  if (dirnameHint) {
    return normalizePath(dirnameHint);
  }

  return null;
}

function buildExplicitCandidates(appRoot, relativeCandidates, envEntry) {
  const candidates = [];

  if (envEntry) {
    const envPath = normalizePath(envEntry);
    if (!isForbiddenRuntimePath(envPath)) {
      candidates.push(envPath);
    }
  }

  if (appRoot) {
    for (const relative of relativeCandidates) {
      candidates.push(normalizePath(path.join(appRoot, relative)));
    }
  }

  // Deduplicate while preserving order.
  const seen = new Set();
  return candidates.filter((candidatePath) => {
    const key = toPosixPath(candidatePath);
    if (seen.has(key) || isForbiddenRuntimePath(candidatePath)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function existingPath(candidatePaths) {
  const normalized = (candidatePaths || []).filter(Boolean).map((candidate) => normalizePath(candidate));
  const allowed = normalized.filter((candidatePath) => !isForbiddenRuntimePath(candidatePath));
  return {
    candidates: allowed.map((candidatePath) => ({
      path: candidatePath,
      exists: fs.existsSync(candidatePath),
    })),
    resolved: allowed.find((candidatePath) => fs.existsSync(candidatePath)) || null,
  };
}

function getBackendEntryCandidates({ appRoot, resourcesPath, dirnameHint, envEntry, packaged } = {}) {
  const root =
    packaged || resourcesPath
      ? getPackagedAppRoot({ resourcesPath, appRoot, dirnameHint })
      : normalizePath(appRoot || dirnameHint);

  return existingPath(buildExplicitCandidates(root, BACKEND_ENTRY_RELATIVE_CANDIDATES, envEntry));
}

function getFrontendEntryCandidates({ appRoot, resourcesPath, dirnameHint, packaged } = {}) {
  const root =
    packaged || resourcesPath
      ? getPackagedAppRoot({ resourcesPath, appRoot, dirnameHint })
      : normalizePath(appRoot || dirnameHint);

  return existingPath(buildExplicitCandidates(root, FRONTEND_ENTRY_RELATIVE_CANDIDATES));
}

function getWhatsAppHelperEntryCandidates({ appRoot, resourcesPath, dirnameHint, packaged } = {}) {
  const root =
    packaged || resourcesPath
      ? getPackagedAppRoot({ resourcesPath, appRoot, dirnameHint })
      : normalizePath(appRoot || dirnameHint);

  return existingPath(buildExplicitCandidates(root, WHATSAPP_HELPER_RELATIVE_CANDIDATES));
}

function getLicensePublicKeyUtilCandidates({ appRoot, resourcesPath, dirnameHint, packaged } = {}) {
  const root =
    packaged || resourcesPath
      ? getPackagedAppRoot({ resourcesPath, appRoot, dirnameHint })
      : normalizePath(appRoot || dirnameHint);

  return existingPath(buildExplicitCandidates(root, LICENSE_PUBLIC_KEY_UTIL_RELATIVE_CANDIDATES));
}

function getCanonicalBackendEntryPath(appRoot) {
  if (!appRoot) {
    return null;
  }
  return normalizePath(path.join(appRoot, BACKEND_ENTRY_RELATIVE_CANDIDATES[0]));
}

module.exports = {
  BACKEND_ENTRY_RELATIVE_CANDIDATES,
  FRONTEND_ENTRY_RELATIVE_CANDIDATES,
  WHATSAPP_HELPER_RELATIVE_CANDIDATES,
  LICENSE_PUBLIC_KEY_UTIL_RELATIVE_CANDIDATES,
  isForbiddenRuntimePath,
  getPackagedAppRoot,
  getCanonicalBackendEntryPath,
  existingPath,
  getBackendEntryCandidates,
  getFrontendEntryCandidates,
  getWhatsAppHelperEntryCandidates,
  getLicensePublicKeyUtilCandidates,
};
