import { readFileSync } from 'fs';
import * as path from 'path';

describe('production monitoring runtime contract', () => {
  const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), 'utf8');
  const helper = read('src', 'collectors', 'whatsapp-helper.main.ts');
  const service = read('src', 'collectors', 'whatsapp-collector.service.ts');
  const desktop = read('desktop', 'main.js');
  const monitoringPage = read('web', 'src', 'pages', 'collector-page.tsx');
  const setupPage = read('web', 'src', 'pages', 'setup-page.tsx');
  const mappingService = read('src', 'patrol-groups', 'patrol-groups.service.ts');

  it('resumes only the explicit persisted monitoring preference', () => {
    expect(desktop).toContain('workspaceConfig.setupCompleted === true && workspaceConfig.autoStartCollector === true');
    expect(service).toContain("monitoringPreference: this.monitoringEnabled ? 'ENABLED' : 'PAUSED'");
    expect(service).toContain("writeDesktopWorkspaceConfigPatch({ autoStartCollector: true })");
    expect(service).toContain("writeDesktopWorkspaceConfigPatch({ autoStartCollector: false })");
    expect(service).toContain("WHATSAPP_SESSION_AUTORECONNECT monitoring=paused");
  });

  it('keeps production listener control separate from certification gating', () => {
    expect(helper).toContain("command.type === 'set-production-monitoring'");
    expect(helper).toContain('runtimeConfig.monitoringEnabled && runtimeConfig.mappedGroups.length > 0');
    expect(helper).toContain("command.type === 'arm-certification-live-ingestion'");
    expect(service).toContain('Production monitoring is unavailable in certification mode.');
  });

  it('requires a page event bridge before client-info fallback can report ready', () => {
    expect(helper).toContain("context.readySource === 'client-info-detected'");
    expect(helper).toContain("'client-info-ready-deferred'");
    expect(helper).toContain('reason=live-event-bridge-not-attached');
    expect(helper).toContain('__wwebjsLiveEventBridgeAttached');
  });

  it('owns production listeners by current client and startup generation', () => {
    expect(helper).toContain('listenerBoundClient === target');
    expect(helper).toContain('listenerBoundAttemptId === activeStartupAttemptId');
    expect(helper).toContain('bindingIsCurrent');
  });

  it('does not block helper readiness on discovery or trigger backfill when a saved session becomes ready', () => {
    const readyStart = helper.indexOf('async function finalizeClientReady');
    const readyEnd = helper.indexOf('async function watchClientInfoAfterAuthentication', readyStart);
    const readyBody = helper.slice(readyStart, readyEnd);
    expect(readyBody).not.toContain('await refreshDiscoveredChats()');
    expect(readyBody).not.toContain('runBackfill(');
    expect(service).toContain('this.maybeRequestChatDiscoveryRefresh();');
  });

  it('separates live telemetry from actual backfill telemetry', () => {
    expect(helper).toContain("if (source === 'live') status.liveMessagesProcessed += 1;");
    expect(helper).toContain("if (source === 'live') status.liveImagesImported += 1;");
    expect(helper).toContain("if (source === 'live') status.liveDuplicatesSkipped += 1;");
  });

  it('reconciles mapping changes without creating another helper generation', () => {
    expect(service).toContain("subscribeToMappingChanges(() => {");
    expect(service).toContain("this.sendHelperCommand({ type: 'set-production-monitoring', enabled });");
    expect(service).not.toContain("reason=mapping-change action=start-new-helper");
  });

  it('provides customer monitoring controls without using collector stop as pause', () => {
    expect(monitoringPage).toContain('Start monitoring');
    expect(monitoringPage).toContain('Pause monitoring');
    expect(monitoringPage).toContain('onClick={() => void enableMonitoring()}');
    expect(monitoringPage).toContain('onClick={() => void pauseMonitoring()}');
  });

  it('provides reassignment and non-destructive mapping lifecycle controls', () => {
    expect(setupPage).toContain('Move to selected site');
    expect(setupPage).toContain('Deactivate mapping');
    expect(setupPage).toContain('Reactivate mapping');
    expect(setupPage).toContain('Historical evidence will not change.');
    expect(mappingService).toContain('assertCustomerAccountScope(group, user)');
    expect(mappingService).toContain('notifyMappingChanged()');
  });
});
