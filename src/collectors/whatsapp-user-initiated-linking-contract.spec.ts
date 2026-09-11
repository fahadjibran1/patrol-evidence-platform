import { readFileSync } from 'fs';
import * as path from 'path';

describe('user-initiated WhatsApp linking contract', () => {
  const read = (...parts: string[]): string => readFileSync(path.join(process.cwd(), ...parts), 'utf8');
  const desktopMain = read('desktop', 'main.js');
  const desktopStorage = read('src', 'desktop', 'desktop-storage.util.ts');
  const supervisor = read('src', 'collectors', 'whatsapp-collector.service.ts');
  const helper = read('src', 'collectors', 'whatsapp-helper.main.ts');
  const collectorPage = read('web', 'src', 'pages', 'collector-page.tsx');
  const monitoringState = read('web', 'src', 'state', 'monitoring.tsx');

  it('does not auto-link on first run but resumes an explicitly enabled monitoring preference', () => {
    const runtimeValuesStart = desktopMain.indexOf('function getConfiguredRuntimeValues()');
    const runtimeValuesEnd = desktopMain.indexOf('function isProductionDesktopMode()', runtimeValuesStart);
    const runtimeValues = desktopMain.slice(runtimeValuesStart, runtimeValuesEnd);
    expect(runtimeValues).toContain('workspaceConfig.setupCompleted === true && workspaceConfig.autoStartCollector === true');
    expect(desktopStorage).toContain("if (process.env.DESKTOP_CONFIG_PATH?.trim())");
    expect(desktopStorage).toContain('return config.setupCompleted === true;');
    expect(desktopMain).toContain('autoStartCollector: false');
  });

  it('exposes deliberate Link WhatsApp and Cancel linking actions', () => {
    expect(collectorPage).toContain('Link WhatsApp');
    expect(collectorPage).toContain('Cancel linking');
    expect(collectorPage).toContain('onClick={() => void start()}');
    expect(collectorPage).toContain('onClick={() => void stop()}');
    expect(collectorPage).toContain('Scan only the current QR shown here in PatrolSafe.');
  });

  it('never hydrates a prior QR and accepts QR only from current helper status events', () => {
    expect(helper).not.toContain('hydrateCachedQrForStartup');
    expect(supervisor).not.toContain('hydrateQrFromDiskIfMissing');
    expect(supervisor).toContain('this.clearPreviousQrArtifact();');
    expect(supervisor).toContain("if (this.helperStatus.qrCode && this.helperStatus.qrCode !== previousQr)");
  });

  it('replaces QR promptly and clears it when the linking state ends', () => {
    expect(monitoringState).toContain('const MONITORING_POLL_LINKING_MS = 1_000;');
    expect(collectorPage).toContain('key={status.lastQrAt ?? status.qrCode}');
    expect(supervisor).toContain('if (!qrEligibleStates.has(this.helperStatus.state))');
    expect(supervisor).toContain('qrCode: null');
  });

  it('retains the pre-authentication certification and discovery boundary', () => {
    expect(supervisor).toContain('isQrOnlyCertificationMode()');
    expect(helper).toContain("stopForUnexpectedAuthentication('authenticated')");
    const authenticatedHandler = helper.slice(
      helper.indexOf("nextClient.on('authenticated'"),
      helper.indexOf("nextClient.on('change_state'"),
    );
    expect(authenticatedHandler.indexOf("stopForUnexpectedAuthentication('authenticated')")).toBeLessThan(
      authenticatedHandler.indexOf('watchClientInfoAfterAuthentication'),
    );
  });
});
