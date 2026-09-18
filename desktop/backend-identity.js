const crypto = require('crypto');

const BACKEND_IDENTITY = 'patrolsafe-desktop-backend';
const BACKEND_READY_PREFIX = 'PATROLSAFE_DESKTOP_BACKEND_READY ';
const BACKEND_IDENTITY_PATH = '/desktop/bootstrap/runtime-identity';
const BACKEND_CHALLENGE_HEADER = 'x-patrolsafe-backend-challenge';

function identityMessage(payload) {
  return [
    BACKEND_IDENTITY,
    String(payload.appVersion || ''),
    String(payload.buildId || ''),
    String(payload.processId || ''),
    String(payload.sessionId || ''),
    String(payload.challenge || ''),
  ].join('\n');
}

function createIdentityProof(secret, payload) {
  const normalizedSecret = String(secret || '').trim();
  if (normalizedSecret.length < 32) {
    throw new Error('Desktop backend identity secret is unavailable');
  }

  return crypto.createHmac('sha256', normalizedSecret).update(identityMessage(payload)).digest('hex');
}

function createIdentityResponse(secret, payload) {
  const response = {
    identity: BACKEND_IDENTITY,
    appVersion: String(payload.appVersion || ''),
    buildId: String(payload.buildId || ''),
    processId: Number(payload.processId),
    sessionId: String(payload.sessionId || ''),
    challenge: String(payload.challenge || ''),
  };

  return {
    ...response,
    proof: createIdentityProof(secret, response),
  };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyIdentityResponse(secret, actual, expected) {
  if (!actual || typeof actual !== 'object') return false;
  const fieldsMatch =
    actual.identity === BACKEND_IDENTITY &&
    actual.appVersion === expected.appVersion &&
    actual.buildId === expected.buildId &&
    Number(actual.processId) === Number(expected.processId) &&
    actual.sessionId === expected.sessionId &&
    actual.challenge === expected.challenge;
  if (!fieldsMatch) return false;

  let expectedProof;
  try {
    expectedProof = createIdentityProof(secret, actual);
  } catch {
    return false;
  }
  return safeEqual(actual.proof, expectedProof);
}

function parseReadyAnnouncement(line) {
  const value = String(line || '').trim();
  if (!value.startsWith(BACKEND_READY_PREFIX)) return null;

  try {
    const parsed = JSON.parse(value.slice(BACKEND_READY_PREFIX.length));
    const port = Number(parsed.port);
    const processId = Number(parsed.processId);
    if (
      parsed.identity !== BACKEND_IDENTITY ||
      parsed.host !== '127.0.0.1' ||
      !Number.isInteger(port) || port < 1 || port > 65535 ||
      !Number.isInteger(processId) || processId < 1 ||
      typeof parsed.sessionId !== 'string' || parsed.sessionId.length < 16
    ) {
      return null;
    }
    return {
      identity: parsed.identity,
      host: parsed.host,
      port,
      processId,
      sessionId: parsed.sessionId,
    };
  } catch {
    return null;
  }
}

module.exports = {
  BACKEND_CHALLENGE_HEADER,
  BACKEND_IDENTITY,
  BACKEND_IDENTITY_PATH,
  BACKEND_READY_PREFIX,
  createIdentityProof,
  createIdentityResponse,
  parseReadyAnnouncement,
  verifyIdentityResponse,
};
