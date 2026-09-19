import { readFileSync } from 'fs';
import * as path from 'path';

describe('WhatsApp unexpected-session recovery contract', () => {
  const helper = readFileSync(path.join(process.cwd(), 'src', 'collectors', 'whatsapp-helper.main.ts'), 'utf8');
  const manager = readFileSync(path.join(process.cwd(), 'src', 'collectors', 'whatsapp-collector.service.ts'), 'utf8');

  it('classifies an unexpected healthy logout without deleting LocalAuth', () => {
    expect(helper).toContain('unexpectedHealthySessionEnd');
    expect(helper).toContain('WHATSAPP_SESSION_RECOVERY_REQUIRED');
    expect(helper).toContain('Do not logout/delete LocalAuth here');
    expect(helper).toContain('disconnected-ignored-stale-attempt');
    expect(helper).toContain('ready-ignored-stale-attempt');
  });

  it('uses bounded fresh generations and terminal relink rather than stale callbacks', () => {
    expect(manager).toContain('runSessionRecovery');
    expect(manager).toContain('releaseCurrentProfileOwnership(profileDir, failedGeneration)');
    expect(manager).toContain('maxAutomaticSessionRecoveryAttempts = 2');
    expect(manager).toContain("state: 'RELINK_REQUIRED'");
    expect(manager).toContain('Your sites, mappings, schedules and evidence are preserved.');
  });
});
