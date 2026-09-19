import { readFileSync } from 'fs';
import * as path from 'path';

describe('WhatsApp relink-required renderer contract', () => {
  const monitoringState = readFileSync(
    path.join(process.cwd(), 'web', 'src', 'lib', 'monitoring-state.ts'),
    'utf8',
  );
  const collectorPage = readFileSync(
    path.join(process.cwd(), 'web', 'src', 'pages', 'collector-page.tsx'),
    'utf8',
  );
  const monitoringContext = readFileSync(
    path.join(process.cwd(), 'web', 'src', 'state', 'monitoring.tsx'),
    'utf8',
  );

  it('maps RELINK_REQUIRED to a non-QR expired-session view', () => {
    expect(monitoringState).toContain("status.state === 'RELINK_REQUIRED'");
    expect(monitoringState).toContain("case 'relink-required':\n      return 'Session expired';");
    expect(monitoringState).toContain("phase === 'relink-required'\n      ? 'RELINK REQUIRED'");
    expect(monitoringState).toContain("status.state === 'RELINK_REQUIRED'");
  });

  it('shows explicit relink guidance and preserves a guarded action boundary', () => {
    expect(collectorPage).toContain('Relink to continue; your sites, mappings, schedules and evidence remain preserved.');
    expect(collectorPage).toContain('Relink WhatsApp');
    expect(collectorPage).toContain("onClick={() => void relink()}");
    expect(monitoringContext).toContain("runAction('/collectors/whatsapp/relink')");
  });
});
