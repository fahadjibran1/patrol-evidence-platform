import { readFileSync } from 'fs';
import * as path from 'path';

describe('WhatsApp explicit relink flow contract', () => {
  const service = readFileSync(path.join(process.cwd(), 'src', 'collectors', 'whatsapp-collector.service.ts'), 'utf8');
  const controller = readFileSync(path.join(process.cwd(), 'src', 'collectors', 'collectors.controller.ts'), 'utf8');
  const monitoring = readFileSync(path.join(process.cwd(), 'web', 'src', 'state', 'monitoring.tsx'), 'utf8');

  it('exposes a dedicated endpoint and action only for RELINK_REQUIRED', () => {
    expect(controller).toContain("@Post('relink')");
    expect(controller).toContain('relinkWhatsApp()');
    expect(service).toContain("this.helperStatus.state !== 'RELINK_REQUIRED'");
    expect(service).toContain('available only after a failed reconnect session');
    expect(monitoring).toContain("runAction('/collectors/whatsapp/relink')");
  });

  it('archives before creating an empty fresh root and has no delete fallback', () => {
    expect(service).toContain("renameSync(this.sessionPath, archivePath)");
    expect(service).toContain("mkdirSync(this.sessionPath, { recursive: true })");
    expect(service).toContain('readdirSync(this.sessionPath).length !== 0');
    expect(service).toContain('Your existing session data was preserved.');
    const relinkBody = service.slice(service.indexOf('async relinkWhatsApp()'), service.indexOf('async createFreshWhatsAppProfile()'));
    expect(relinkBody).not.toContain('deleteSessionFolderWithRetry');
    expect(relinkBody).not.toContain('rmSync');
  });

  it('uses collision-safe managed archive names and resets certification state', () => {
    expect(service).toContain("'whatsapp-session-archive'");
    expect(service).toContain('randomUUID()');
    expect(service).toContain("this.certificationAuthorizationState = isQrOnlyCertificationMode() ? 'EXPECTING_QR_ONLY' : 'DISABLED'");
    expect(service).toContain("this.certificationTerminal = false");
  });

  it('keeps operational activity out of the relink path', () => {
    const relinkBody = service.slice(service.indexOf('async relinkWhatsApp()'), service.indexOf('async createFreshWhatsAppProfile()'));
    expect(relinkBody).not.toContain('refreshDiscoveredChats');
    expect(relinkBody).not.toContain('manualBackfill');
    expect(relinkBody).not.toContain('sendTestImage');
    expect(relinkBody).toContain('return this.start()');
  });
});
