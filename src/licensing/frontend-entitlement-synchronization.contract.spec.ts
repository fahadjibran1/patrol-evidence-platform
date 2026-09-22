import { readFileSync } from 'fs';
import * as path from 'path';

function readWeb(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), 'web', 'src', relativePath), 'utf8');
}

describe('frontend entitlement synchronization contract', () => {
  const provider = readWeb('state/entitlement.tsx');
  const app = readWeb('App.tsx');
  const layout = readWeb('components/layout.tsx');
  const routeGate = readWeb('components/license-route-gate.tsx');
  const licencePage = readWeb('pages/license-page.tsx');
  const setupPage = readWeb('pages/setup-page.tsx');
  const fileImport = readWeb('lib/licence-file-import.ts');

  it('owns both authoritative entitlement responses in one provider', () => {
    expect(provider).toContain("apiRequest<LicenseStatusResponse>('/license/status'");
    expect(provider).toContain("apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status'");
    expect(provider).toContain('reconciliationSequence');
    expect(app).toContain('<EntitlementProvider>');
  });

  it('updates every entitlement consumer through the shared running-renderer state', () => {
    expect(layout).toContain('useEntitlement()');
    expect(routeGate).toContain('useEntitlement()');
    expect(licencePage).toContain('useEntitlement()');
    expect(setupPage).toContain('useEntitlement()');
    expect(setupPage).toContain("license.displayMode === 'Licensed' && license.status === 'ACTIVE'");
    expect(setupPage).toContain("return 'Licensed';");
    expect(layout).not.toContain("apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status'");
    expect(routeGate).not.toContain("apiRequest<LicenseStatusResponse>('/license/status'");
  });

  it('reconciles expired-to-licensed and inverse transitions after mutation', () => {
    expect(licencePage.match(/await reconcileEntitlement\(next\);/g)).toHaveLength(2);
    expect(setupPage).toContain('await reconcileEntitlement();');
    expect(provider).toContain('setLicenceStatus(knownLicenceStatus)');
  });

  it('separates licence request and activation file types', () => {
    expect(licencePage).toContain('Manual / Offline activation');
    expect(licencePage).toContain('Create licence request (.tgreq)');
    expect(licencePage).toContain('Activate supplied licence (.tglic)');
    expect(fileImport).toContain("LICENCE_IMPORT_ACCEPT = '.tglic'");
  });

  it('keeps online purchase subordinate to the shared local entitlement authority', () => {
    expect(licencePage).toContain("'/license/commercial/purchase'");
    expect(licencePage).toContain("'/license/commercial/status'");
    expect(licencePage).toContain('await reconcileEntitlement(next);');
    expect(licencePage).not.toContain('stripePriceId');
  });
});
