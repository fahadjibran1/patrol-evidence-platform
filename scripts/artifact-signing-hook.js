const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ACCOUNT_NAME = 'vesoft-signing-prod';
const CERTIFICATE_PROFILE_NAME = 'vesoft-public-trust';
const ENDPOINT = 'https://neu.codesigning.azure.net/';
const TIMESTAMP_URL = 'http://timestamp.acs.microsoft.com/';
const SIGNABLE_EXTENSIONS = new Set(['.exe', '.dll', '.node', '.msi']);

function findSignTool() {
  const configured = String(process.env.PATROLSAFE_SIGNTOOL_PATH || '').trim();
  if (configured) {
    return path.resolve(configured);
  }

  const sdkBin = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Windows Kits',
    '10',
    'bin',
  );
  if (!fs.existsSync(sdkBin)) {
    return null;
  }

  return fs
    .readdirSync(sdkBin, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+)+$/.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))
    .map((entry) => path.join(sdkBin, entry.name, 'x64', 'signtool.exe'))
    .find((candidate) => fs.existsSync(candidate));
}

function findArtifactSigningDlib() {
  const configured = String(process.env.PATROLSAFE_ARTIFACT_SIGNING_DLIB || '').trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft',
    'MicrosoftArtifactSigningClientTools',
    'Azure.CodeSigning.Dlib.dll',
  );
}

function createMetadataFile() {
  const correlationId = String(
    process.env.PATROLSAFE_ARTIFACT_SIGNING_CORRELATION_ID || `patrolsafe-local-rc-${process.pid}`,
  ).trim();
  const filePath = path.join(os.tmpdir(), `patrolsafe-artifact-signing-${process.pid}.json`);
  const metadata = {
    Endpoint: ENDPOINT,
    CodeSigningAccountName: ACCOUNT_NAME,
    CertificateProfileName: CERTIFICATE_PROFILE_NAME,
    CorrelationId: correlationId,
    ExcludeCredentials: [
      'EnvironmentCredential',
      'ManagedIdentityCredential',
      'WorkloadIdentityCredential',
      'SharedTokenCacheCredential',
      'VisualStudioCredential',
      'VisualStudioCodeCredential',
      'AzurePowerShellCredential',
      'AzureDeveloperCliCredential',
      'InteractiveBrowserCredential',
    ],
  };
  fs.writeFileSync(filePath, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return filePath;
}

let metadataPath;
function getMetadataPath() {
  if (!metadataPath) {
    metadataPath = createMetadataFile();
    process.once('exit', () => {
      try {
        fs.rmSync(metadataPath, { force: true });
      } catch {
        // Best effort. This file contains resource coordinates but no credential material.
      }
    });
  }
  return metadataPath;
}

function assertFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} was not found: ${filePath || '<unset>'}`);
  }
}

function buildSignToolArgs(filePath, dlibPath, signingMetadataPath) {
  return [
    'sign',
    '/v',
    '/debug',
    '/fd',
    'SHA256',
    '/tr',
    TIMESTAMP_URL,
    '/td',
    'SHA256',
    '/dlib',
    dlibPath,
    '/dmdf',
    signingMetadataPath,
    filePath,
  ];
}

async function signWindowsArtifact(fileToSign) {
  const filePath = path.resolve(fileToSign);
  const extension = path.extname(filePath).toLowerCase();
  if (!SIGNABLE_EXTENSIONS.has(extension)) {
    console.log(`[artifact-signing] Skip non-PE signing candidate: ${path.basename(filePath)}`);
    return;
  }

  assertFile(filePath, 'Signing target');
  const signToolPath = findSignTool();
  const dlibPath = findArtifactSigningDlib();
  assertFile(signToolPath, 'x64 Windows SDK SignTool');
  assertFile(dlibPath, 'Microsoft Artifact Signing Dlib');

  const result = spawnSync(
    signToolPath,
    buildSignToolArgs(filePath, dlibPath, getMetadataPath()),
    { stdio: 'inherit', windowsHide: true, env: process.env },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `AZURE_ARTIFACT_SIGNING_FAILED file=${path.basename(filePath)} exit=${result.status ?? 'unknown'}`,
    );
  }
}

module.exports = signWindowsArtifact;
module.exports.constants = {
  ACCOUNT_NAME,
  CERTIFICATE_PROFILE_NAME,
  ENDPOINT,
  TIMESTAMP_URL,
};
module.exports.buildSignToolArgs = buildSignToolArgs;
module.exports.findArtifactSigningDlib = findArtifactSigningDlib;
module.exports.findSignTool = findSignTool;
