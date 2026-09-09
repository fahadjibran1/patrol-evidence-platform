import { readFileSync } from 'fs';
import * as path from 'path';

describe('bounded WhatsApp first-link retry contract', () => {
  const read = (...parts: string[]): string => readFileSync(path.join(process.cwd(), ...parts), 'utf8');
  const controller = read('src', 'collectors', 'collectors.controller.ts');
  const supervisor = read('src', 'collectors', 'whatsapp-collector.service.ts');
  const helper = read('src', 'collectors', 'whatsapp-helper.main.ts');
  const collectorPage = read('web', 'src', 'pages', 'collector-page.tsx');
  const desktopSetupPage = read('web', 'src', 'pages', 'desktop-setup-page.tsx');
  const monitoringContext = read('web', 'src', 'state', 'monitoring.tsx');

  it('exposes Try Again only through the dedicated recoverable-link action', () => {
    expect(controller).toContain("@Post('retry-link')");
    expect(monitoringContext).toContain("runAction('/collectors/whatsapp/retry-link')");
    expect(collectorPage).toContain('Try Again');
    expect(desktopSetupPage).toContain('Try Again');
    expect(collectorPage).toContain('WhatsApp could not initialise. Check your internet connection and try again.');
    expect(desktopSetupPage).toContain("? 'WhatsApp could not initialise'");
    expect(desktopSetupPage).toContain("? 'Check your internet connection and try again.'");
  });

  it('keeps recoverable first-link failure distinct from RELINK_REQUIRED', () => {
    expect(supervisor).toContain("state: LINK_RETRY_REQUIRED");
    expect(supervisor).toContain("this.helperStatus.state !== LINK_RETRY_REQUIRED");
    expect(collectorPage).toContain("view.phase === 'link-retry-required'");
    expect(collectorPage).toContain("view.phase === 'relink-required'");
  });

  it('pins a launched browser for the attempt and retains launch-failure fallback', () => {
    expect(helper).toContain('const browserStarted = Boolean(');
    expect(helper).toContain('shouldFallbackToNextBrowser({');
    expect(helper).toContain("'browser-fallback-suppressed-after-launch'");
    expect(helper).toContain('hasNextCandidate: browserIndex < launchPlan.length - 1');
  });

  it('does not misclassify released never-authenticated retry files as a reconnect session', () => {
    const candidateStart = helper.indexOf('function hasExistingLocalAuthSessionCandidate()');
    const candidateEnd = helper.indexOf('async function waitForReconnectCertificationAuthorization()', candidateStart);
    const candidate = helper.slice(candidateStart, candidateEnd);
    expect(candidate).toContain('if (FIRST_LINK_ATTEMPT)');
    expect(candidate.indexOf('if (FIRST_LINK_ATTEMPT)')).toBeLessThan(candidate.indexOf('existsSync(profileDir)'));
  });

  it('requires bounded release before presenting Try Again', () => {
    const cleanupStart = supervisor.indexOf('private async completeLinkRetryCleanup(');
    const cleanupEnd = supervisor.indexOf('private async releaseCurrentProfileOwnership(', cleanupStart);
    const cleanup = supervisor.slice(cleanupStart, cleanupEnd);
    expect(cleanup.indexOf('await this.stopHelperProcess();')).toBeLessThan(
      cleanup.indexOf('await this.releaseCurrentProfileOwnership(profileDir, generation);'),
    );
    expect(cleanup.indexOf('await this.releaseCurrentProfileOwnership(profileDir, generation);')).toBeLessThan(
      cleanup.indexOf('state: LINK_RETRY_REQUIRED'),
    );
    expect(cleanup).not.toContain('archiveCurrentSessionForFreshLink');
    expect(cleanup).not.toContain('deleteSessionFolder');
    expect(cleanup).not.toContain('.logout(');
    expect(cleanup).not.toContain('.unlink(');
  });

  it('keeps polling quickly while recoverable cleanup is being completed', () => {
    expect(monitoringContext).toContain('LINK_RETRY_CLEANUP_FAILURE_CODES');
    expect(monitoringContext).toContain("status?.state === 'failed'");
    expect(monitoringContext).toContain('(view.isLinking && !view.isLive) || awaitingLinkRetryCleanup');
  });

  it('does not expose diagnostic implementation details in customer recovery copy', () => {
    const pageCopy = `${collectorPage}\n${desktopSetupPage}`;
    const safeMessage = 'WhatsApp could not initialise. Check your internet connection and try again.';
    expect(pageCopy).toContain(safeMessage);
    const messageContext = pageCopy
      .split('\n')
      .filter((line) => line.includes('could not initialise') || line.includes('Try Again'))
      .join('\n');
    expect(messageContext).not.toMatch(/Puppeteer|HTTP 404|CDN|authentication selector timeout/i);
  });
});
