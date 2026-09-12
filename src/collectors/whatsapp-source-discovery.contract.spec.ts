import { readFileSync } from 'fs';
import * as path from 'path';

describe('customer WhatsApp source discovery contract', () => {
  const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), 'utf8');
  const helper = read('src', 'collectors', 'whatsapp-helper.main.ts');
  const service = read('src', 'collectors', 'whatsapp-collector.service.ts');
  const setup = read('web', 'src', 'pages', 'setup-page.tsx');
  const desktopSetup = read('web', 'src', 'pages', 'desktop-setup-page.tsx');

  it('automatically requests source metadata after the current helper becomes ready', () => {
    expect(service).toContain("previousState !== 'ready' && this.helperStatus.state === 'ready'");
    expect(service).toContain('this.maybeRequestChatDiscoveryRefresh();');
  });

  it('permits source discovery while monitoring is paused and blocks it while unready', () => {
    const start = service.indexOf('async refreshDiscoveredChats()');
    const end = service.indexOf('async start()', start);
    const body = service.slice(start, end);
    expect(body).toContain("this.helperStatus.state !== 'ready'");
    expect(body).not.toContain('this.monitoringEnabled');
    expect(body).toContain("sourceDiscoveryState = 'LOADING'");
  });

  it('awaits a correlated helper result instead of immediately reading an empty cache', () => {
    expect(service).toContain("type: 'refresh-discovered-chats', requestId");
    expect(service).toContain("event.type === 'source-discovery-result'");
    expect(service).toContain('await promise;');
  });

  it('reads only minimum collection metadata and never accesses messages or media', () => {
    const start = helper.indexOf('async function readWhatsAppSourceMetadata');
    const end = helper.indexOf('async function reportChatDiscoveryFailure', start);
    const body = helper.slice(start, end);
    expect(body).toContain("require?.('WAWebCollections')");
    expect(body).toContain('Chat?: { getModelsArray?: () => unknown[] }');
    expect(body).not.toContain('getChats(');
    expect(body).not.toContain('fetchMessages');
    expect(body).not.toContain('downloadMedia');
    expect(body).not.toContain('.serialize(');
  });

  it('reports loading, available/empty, and customer-safe error states', () => {
    expect(setup).toContain("sourceDiscoveryState === 'LOADING'");
    expect(setup).toContain("sourceDiscoveryState === 'ERROR'");
    expect(setup).toContain('No eligible WhatsApp sources found');
    expect(desktopSetup).toContain('Refresh sources');
    expect(desktopSetup).toContain('Unable to load WhatsApp sources');
  });

  it('uses discovered display names in normal flow without requiring a raw JID', () => {
    expect(setup).toContain('{entry.name}');
    expect(setup).toContain('onChange={(event) => handleDiscoveredSourceSelection(event.target.value)}');
    expect(setup).toContain('<summary>Advanced options</summary>');
  });

  it('keeps discovery and mutation endpoints role/auth protected', () => {
    const controller = read('src', 'collectors', 'collectors.controller.ts');
    expect(controller).toContain('@UseGuards(JwtAuthGuard, RolesGuard, LicenceFeatureGuard)');
    expect(controller).toContain('@Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)');
  });
});
