import { readFileSync } from 'fs';
import * as path from 'path';

describe('WhatsApp QR relink lifecycle contract', () => {
  const helper = readFileSync(
    path.join(process.cwd(), 'src', 'collectors', 'whatsapp-helper.main.ts'),
    'utf8',
  );

  function handler(start: string, end: string): string {
    const startAt = helper.indexOf(start);
    const endAt = helper.indexOf(end, startAt + start.length);
    expect(startAt).toBeGreaterThanOrEqual(0);
    expect(endAt).toBeGreaterThan(startAt);
    return helper.slice(startAt, endAt);
  }

  it('does not infer a QR scan from pairing, opening, syncing, expiry, or logout navigation', () => {
    const stateHandler = handler("nextClient.on('change_state'", "nextClient.on('ready'");
    expect(stateHandler).toContain("if (/^CONNECTED$/i.test(state))");
    expect(stateHandler).not.toMatch(/pairing\|opening/);

    const navigationHandler = handler("page.on('framenavigated'", "page.on('domcontentloaded'");
    expect(navigationHandler).not.toContain("markQrScanDetected('post-logout-navigation'");
    expect(helper).toContain("markQrScanDetected('authenticated-event'");
  });

  it.each([
    ["nextClient.on('qr'", "nextClient.on('authenticated'"],
    ["nextClient.on('authenticated'", "nextClient.on('change_state'"],
    ["nextClient.on('change_state'", "nextClient.on('ready'"],
    ["nextClient.on('ready'", "nextClient.on('disconnected'"],
    ["nextClient.on('disconnected'", "nextClient.on('auth_failure'"],
    ["nextClient.on('auth_failure'", 'client = nextClient'],
  ])('rejects stale client callbacks in %s', (start, end) => {
    expect(handler(start, end)).toContain('isActiveClientGeneration(nextClient, startupAttemptId)');
  });

  it('tracks diagnostics per page rather than through a reusable global boolean', () => {
    expect(helper).toContain('const diagnosedPages = new WeakSet<object>();');
    expect(helper).toContain('diagnosedPages.has(page)');
    expect(helper).toContain('diagnosedPages.add(page)');
    expect(helper).not.toContain('pageDiagnosticsAttached');
  });

  it('retries an unscanned disconnected QR lifecycle and clears all stale QR state', () => {
    const retryPolicy = handler('function isRetryableStartupFailure', 'function rememberModuleCompatibilitySignal');
    expect(retryPolicy).toContain("if (outcome === 'disconnected')");
    expect(retryPolicy).toContain('return !hasPassedQrScanPhase()');

    const disconnected = handler("nextClient.on('disconnected'", "nextClient.on('auth_failure'");
    expect(disconnected).toContain('clearLatestQrPayload()');
    expect(disconnected).toContain('qrCode: null');
    expect(disconnected).toContain('qrPayloadLength: null');
  });
});
