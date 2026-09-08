import { readFileSync } from 'fs';
import * as path from 'path';
import { shouldPreserveFreshQrLinkClient } from './whatsapp-qr-link-transition.util';

describe('fresh WhatsApp QR link transition', () => {
  const baseline = {
    reason: 'LOGOUT',
    currentGeneration: true,
    existingLocalAuthSessionCandidate: false,
    qrReceivedForCurrentAttempt: true,
    authenticationReachedForCurrentAttempt: false,
    readinessFinalized: false,
    operatorLogoutRequested: false,
    shutdownRequested: false,
  };

  it('preserves the current fresh-link client through a post-QR LOGOUT transition', () => {
    expect(shouldPreserveFreshQrLinkClient(baseline)).toBe(true);
  });

  it('does not infer a scan when preserving the transitional disconnect', () => {
    const helper = readFileSync(
      path.join(process.cwd(), 'src', 'collectors', 'whatsapp-helper.main.ts'),
      'utf8',
    );
    const branchStart = helper.indexOf('shouldPreserveFreshQrLinkClient({');
    const branchEnd = helper.indexOf('clearStartupTimeouts();', branchStart);
    const branch = helper.slice(branchStart, branchEnd);

    expect(branch).toContain("'fresh-qr-link-transition-preserved'");
    expect(branch).not.toContain('markQrScanDetected');
    expect(branch).not.toContain('client = null');
    expect(branch).not.toContain('resolveStartupOnce');
  });

  it.each([
    ['no QR was emitted', { qrReceivedForCurrentAttempt: false }],
    ['the callback is stale', { currentGeneration: false }],
    ['the profile is an existing reconnect candidate', { existingLocalAuthSessionCandidate: true }],
    ['authentication already started', { authenticationReachedForCurrentAttempt: true }],
    ['readiness is finalized', { readinessFinalized: true }],
    ['the operator requested logout', { operatorLogoutRequested: true }],
    ['shutdown is active', { shutdownRequested: true }],
    ['the disconnect reason is not LOGOUT', { reason: 'CONFLICT' }],
  ])('does not preserve the client when %s', (_label, override) => {
    expect(shouldPreserveFreshQrLinkClient({ ...baseline, ...override })).toBe(false);
  });

  it('keeps the preservation branch ahead of terminal disconnect cleanup', () => {
    const helper = readFileSync(
      path.join(process.cwd(), 'src', 'collectors', 'whatsapp-helper.main.ts'),
      'utf8',
    );
    const handlerStart = helper.indexOf("nextClient.on('disconnected'");
    const preserveAt = helper.indexOf('shouldPreserveFreshQrLinkClient({', handlerStart);
    const cleanupAt = helper.indexOf('clearStartupTimeouts();', handlerStart);
    const releaseAt = helper.indexOf('client = null;', handlerStart);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(preserveAt).toBeGreaterThan(handlerStart);
    expect(preserveAt).toBeLessThan(cleanupAt);
    expect(preserveAt).toBeLessThan(releaseAt);
  });
});
