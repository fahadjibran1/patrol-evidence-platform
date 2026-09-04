const DEFAULT_BACKEND_PORT = 3001;
const QR_ONLY_CERTIFICATION_ENV = 'PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED';
const QR_ONLY_CERTIFICATION_PROCESS_MARKER = '--patrol-certification-qr-only';

function getBackendProcessArguments(entryPoint, environment = process.env, argv = process.argv) {
  const args = [entryPoint];
  if (
    environment[QR_ONLY_CERTIFICATION_ENV] === 'true' &&
    argv.includes(QR_ONLY_CERTIFICATION_PROCESS_MARKER)
  ) {
    args.push(QR_ONLY_CERTIFICATION_PROCESS_MARKER);
  }
  return args;
}
const API_BASE_URL_ARGUMENT = '--patrol-api-base-url=';

function normalizeBackendPort(value, fallback = DEFAULT_BACKEND_PORT) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}

function getApiBaseUrlArgument(port) {
  return `${API_BASE_URL_ARGUMENT}${getApiBaseUrl(port)}`;
}

function getApiBaseUrl(port) {
  return `http://localhost:${normalizeBackendPort(port)}`;
}

module.exports = {
  DEFAULT_BACKEND_PORT,
  QR_ONLY_CERTIFICATION_ENV,
  QR_ONLY_CERTIFICATION_PROCESS_MARKER,
  getBackendProcessArguments,
  getApiBaseUrl,
  getApiBaseUrlArgument,
  normalizeBackendPort,
};
