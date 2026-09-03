const DEFAULT_BACKEND_PORT = 3001;
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
  getApiBaseUrl,
  getApiBaseUrlArgument,
  normalizeBackendPort,
};
