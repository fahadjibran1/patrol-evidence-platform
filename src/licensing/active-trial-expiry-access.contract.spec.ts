import { readFileSync } from 'fs';
import * as path from 'path';

describe('active trial expiry customer-access contract', () => {
  const read = (...segments: string[]): string =>
    readFileSync(path.join(process.cwd(), ...segments), 'utf8');

  it('keeps Evidence, Backup, Licence and Support reachable after entitlement expiry', () => {
    const routeGate = read('web', 'src', 'components', 'license-route-gate.tsx');
    for (const route of ['/evidence', '/settings/backup', '/license', '/settings/support']) {
      expect(routeGate).toContain(`'${route}'`);
    }
    expect(routeGate).toContain('useEntitlement()');
    const entitlement = read('web', 'src', 'state', 'entitlement.tsx');
    expect(entitlement).toContain('window.setInterval(refresh, 60_000)');
  });

  it('leaves evidence reads unguarded while helper ingestion has an active entitlement admission check', () => {
    const evidenceController = read('src', 'patrol-images', 'patrol-images.controller.ts');
    const internalCollector = read('src', 'collectors', 'collectors.internal.controller.ts');
    const collectorService = read('src', 'collectors', 'whatsapp-collector.service.ts');
    expect(evidenceController).not.toContain("@RequireLicenceFeature('whatsappMonitoring')");
    expect(internalCollector).toContain('whatsAppCollectorService.ingestFromHelper');
    expect(collectorService).toContain('this.assertEntitlementForHelperIngest();');
  });

  it('enforces expiry by detaching production listeners, not by destroying authentication state', () => {
    const collectorService = read('src', 'collectors', 'whatsapp-collector.service.ts');
    const start = collectorService.indexOf('private applyEntitlementRestriction(');
    const end = collectorService.indexOf('private clearEntitlementRestriction(', start);
    const transition = collectorService.slice(start, end);

    expect(transition).toContain("type: 'set-production-monitoring', enabled: false");
    expect(transition).toContain('productionListenerCount: 0');
    expect(transition).not.toContain('stopHelperProcess');
    expect(transition).not.toContain('resetSession');
    expect(transition).not.toContain('archiveCurrentSession');
    expect(transition).not.toContain('logout');
    expect(transition).not.toContain('unlink');
  });
});
