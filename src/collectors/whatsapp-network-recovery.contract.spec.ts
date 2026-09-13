import { readFileSync } from 'fs';
import * as path from 'path';

describe('WhatsApp production network recovery contract', () => {
  const service = readFileSync(
    path.join(process.cwd(), 'src', 'collectors', 'whatsapp-collector.service.ts'),
    'utf8',
  );
  const helper = readFileSync(
    path.join(process.cwd(), 'src', 'collectors', 'whatsapp-helper.main.ts'),
    'utf8',
  );
  const page = readFileSync(
    path.join(process.cwd(), 'web', 'src', 'pages', 'collector-page.tsx'),
    'utf8',
  );

  it('checks a failed transport state before treating a live helper process as already started', () => {
    const networkRecovery = service.indexOf('isRecoverableWhatsAppNetworkFailure(this.helperStatus)');
    const runningNoOp = service.indexOf('if (this.isHelperRunning())', networkRecovery);
    expect(networkRecovery).toBeGreaterThan(-1);
    expect(runningNoOp).toBeGreaterThan(networkRecovery);
  });

  it('releases helper and profile ownership before probing and starting a replacement generation', () => {
    const recovery = service.slice(service.indexOf('private async runNetworkRecovery('));
    expect(recovery.indexOf('await this.stopHelperProcess()')).toBeLessThan(
      recovery.indexOf('await this.releaseCurrentProfileOwnership'),
    );
    expect(recovery.indexOf('await this.releaseCurrentProfileOwnership')).toBeLessThan(
      recovery.indexOf('await this.checkWhatsAppConnectivity()'),
    );
    expect(recovery.indexOf('await this.checkWhatsAppConnectivity()')).toBeLessThan(
      recovery.indexOf('return this.startInternal()'),
    );
  });

  it('never retries a browser generation blindly for an explicit transport failure', () => {
    const retryPolicy = helper.slice(
      helper.indexOf('function isRetryableStartupFailure('),
      helper.indexOf('function rememberModuleCompatibilitySignal('),
    );
    expect(retryPolicy).toContain("status.failureCode === WHATSAPP_NETWORK_FAILURE_CODE");
    expect(retryPolicy).toContain('isWhatsAppTransportFailure(status.lastError)');
    expect(retryPolicy).toContain('return false;');
  });

  it('force-releases a captured browser root after a broken Puppeteer transport without logout', () => {
    const close = helper.slice(
      helper.indexOf('async function closeBrowserGracefully('),
      helper.indexOf('async function releaseStaleBrowserSession('),
    );
    expect(close).toContain("const browserRootPid = currentClient.pupBrowser?.process()?.pid ?? null");
    expect(close).toContain('await terminateBrowserOwners(');
    expect(close).not.toContain('.logout(');
    expect(close).not.toContain('authStrategy.logout');
  });

  it('uses customer-safe reconnect and retry copy without exposing transport stack details', () => {
    expect(page).toContain('Connection lost. PatrolSafe is reconnecting the saved WhatsApp session.');
    expect(page).toContain("status.failureCode === 'NETWORK_UNAVAILABLE' ? 'Try again'");
    expect(page).not.toContain('ERR_CONNECTION_TIMED_OUT');
    expect(page).not.toContain('NodeWebSocketTransport');
  });
});
