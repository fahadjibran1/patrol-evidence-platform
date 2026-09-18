import { readFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const identity = require('../../desktop/backend-identity') as {
  BACKEND_IDENTITY: string;
  BACKEND_READY_PREFIX: string;
  createIdentityResponse(secret: string, payload: Record<string, unknown>): Record<string, unknown>;
  parseReadyAnnouncement(line: string): Record<string, unknown> | null;
  verifyIdentityResponse(secret: string, actual: Record<string, unknown>, expected: Record<string, unknown>): boolean;
};

describe('packaged desktop backend identity', () => {
  const secret = 's'.repeat(64);
  const expected = {
    appVersion: '1.0.2',
    buildId: '2026.09.18.test',
    processId: 4123,
    sessionId: '52e45df1-5247-45e8-84f0-ce129c777b52',
    challenge: 'c'.repeat(64),
  };

  it('accepts only a proof bound to release, child PID, session, and challenge', () => {
    const response = identity.createIdentityResponse(secret, expected);
    expect(identity.verifyIdentityResponse(secret, response, expected)).toBe(true);
    expect(identity.verifyIdentityResponse(secret, response, { ...expected, buildId: 'spoofed' })).toBe(false);
    expect(identity.verifyIdentityResponse(secret, response, { ...expected, processId: 9000 })).toBe(false);
    expect(identity.verifyIdentityResponse(secret, response, { ...expected, sessionId: 'spoofed-session-id' })).toBe(false);
    expect(identity.verifyIdentityResponse('x'.repeat(64), response, expected)).toBe(false);
  });

  it('rejects generic health and unauthenticated imitation responses', () => {
    expect(identity.verifyIdentityResponse(secret, { status: 'ok' }, expected)).toBe(false);
    expect(identity.verifyIdentityResponse(secret, { identity: identity.BACKEND_IDENTITY, ...expected }, expected)).toBe(false);
  });

  it('accepts only loopback announcements with a valid OS-assigned port and matching shape', () => {
    const line = `${identity.BACKEND_READY_PREFIX}${JSON.stringify({
      identity: identity.BACKEND_IDENTITY,
      host: '127.0.0.1',
      port: 49321,
      processId: 4123,
      sessionId: expected.sessionId,
    })}`;
    expect(identity.parseReadyAnnouncement(line)).toMatchObject({ port: 49321, processId: 4123 });
    expect(identity.parseReadyAnnouncement(line.replace('127.0.0.1', '0.0.0.0'))).toBeNull();
    expect(identity.parseReadyAnnouncement('healthy')).toBeNull();
  });

  it('keeps credentials behind verified Electron ownership in production source', () => {
    const desktopMain = readFileSync(join(process.cwd(), 'desktop', 'main.js'), 'utf8');
    const preload = readFileSync(join(process.cwd(), 'desktop', 'preload.js'), 'utf8');
    expect(desktopMain).toContain("PORT: isProductionDesktopMode() ? '0'");
    expect(desktopMain).toContain('waitForSpawnedBackendIdentity');
    expect(desktopMain).toContain('backendIdentityVerified ? getApiBaseUrl() : null');
    expect(desktopMain).toContain('PatrolSafe local service identity has not been verified');
    expect(desktopMain).toContain('requestSingleInstanceLock');
    expect(desktopMain).toContain("app.on('second-instance'");
    expect(preload).not.toContain("|| 'http://localhost:3001'");
  });
});
