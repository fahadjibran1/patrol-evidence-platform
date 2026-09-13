import { readFileSync } from 'fs';
import { join } from 'path';
import { customerErrorMessage } from '../../web/src/lib/customer-errors';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('PatrolSafe commercial customer UX contract', () => {
  it('routes initialized desktops without a session to login, never first-run setup', () => {
    const app = source('web/src/App.tsx');
    const login = source('web/src/pages/login-page.tsx');

    expect(app).toContain("<Navigate to={token ? '/' : '/login'} replace");
    expect(app).toContain("message: 'Please sign in to continue.'");
    expect(login).not.toContain('First-time setup / Reset workspace');
    expect(login).not.toContain('openRecoverySetup');
  });

  it('keeps initialized workspace editing authenticated and password change explicit', () => {
    const app = source('web/src/App.tsx');
    const company = source('web/src/pages/company-settings-page.tsx');

    expect(app).toContain('path="settings/company"');
    expect(company).toContain('Change administrator password');
    expect(company).toContain("const [newPassword, setNewPassword] = useState('')");
    expect(company).toContain('beginDesktopAdminRecovery()');
    expect(company).not.toContain('Create the local company and admin account');
  });

  it('keeps diagnostics out of primary navigation behind Support', () => {
    const layout = source('web/src/components/layout.tsx');
    const support = source('web/src/pages/support-page.tsx');

    const primary = layout.slice(layout.indexOf('const primaryNavItems'), layout.indexOf('const settingsNavItems'));
    expect(primary).not.toMatch(/diagnostic/i);
    expect(layout).toContain("{ to: '/settings/support', label: 'Support'");
    expect(support).toContain('Show advanced diagnostics');
    expect(support).toContain('to="/settings/diagnostics"');
  });

  it('presents WhatsApp connection and monitoring as independent customer states', () => {
    const status = source('web/src/components/monitoring-status-bar.tsx');

    expect(status).toContain('<span>WhatsApp</span>');
    expect(status).toContain('{view.connectionLabel}');
    expect(status).toContain('<span>Monitoring</span>');
    expect(status).toContain('{view.label}');
    expect(status).not.toContain('Ready / Live');
  });

  it('uses a focused, navigable setup workflow', () => {
    const app = source('web/src/App.tsx');
    const setup = source('web/src/pages/setup-page.tsx');

    expect(app).toContain("window.scrollTo({ top: 0, left: 0, behavior: 'auto' })");
    expect(setup).toContain('const activeStep = selectedStep ?? nextStep');
    expect(setup).toContain("aria-current={activeStep === step.id ? 'step' : undefined}");
    expect(setup).toContain('setup-step-card-hidden');
    expect(setup).toContain('No sites yet');
    expect(setup).toContain('Refresh sources');
  });

  it('does not expose engineering terminology on normal customer screens', () => {
    const customerFiles = [
      'web/src/pages/login-page.tsx',
      'web/src/pages/dashboard-page.tsx',
      'web/src/pages/collector-page.tsx',
      'web/src/pages/evidence-page.tsx',
      'web/src/pages/sites-page.tsx',
      'web/src/pages/setup-page.tsx',
      'web/src/pages/guard-safe-page.tsx',
      'web/src/pages/alerts-page.tsx',
      'web/src/pages/incidents-page.tsx',
      'web/src/pages/patrol-ops-page.tsx',
      'web/src/pages/license-page.tsx',
      'web/src/pages/company-settings-page.tsx',
      'web/src/pages/support-page.tsx',
      'web/src/pages/data-protection-page.tsx',
      'web/src/components/layout.tsx',
      'web/src/components/monitoring-status-bar.tsx',
    ];
    const combined = customerFiles.map(source).join('\n');

    for (const prohibited of [
      'Puppeteer',
      'whatsapp-web.js',
      'LocalAuth',
      'STATE_TRANSITION',
      'NAVIGATION_URL',
      'browser executable',
      'session path',
    ]) {
      expect(combined).not.toContain(prohibited);
    }
    expect(source('web/src/pages/license-page.tsx')).not.toContain('value={status?.status}');
  });

  it('normalizes technical failures before showing them to customers', () => {
    expect(customerErrorMessage(new Error('connect ECONNREFUSED 127.0.0.1:3000'), 'Try again.')).toBe(
      'PatrolSafe could not reach its local service. Wait a moment and try again.',
    );
    expect(customerErrorMessage(new Error('QueryFailedError: SQLITE_BUSY at Database.run'), 'Records could not load.')).toBe(
      'Records could not load.',
    );
    expect(customerErrorMessage(new Error('Site already exists'), 'Try again.')).toBe('Site already exists');
  });
});
