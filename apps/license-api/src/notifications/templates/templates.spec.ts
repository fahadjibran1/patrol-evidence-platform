import { NotificationType } from '@prisma/client';
import { renderBaseTemplate } from './base.template';
import {
  buildDefaultLicenceIssuedSubject,
  renderLicenceIssuedTemplate,
} from './licence-issued.template';

describe('notification templates', () => {
  it('renders base template header body footer and signature', () => {
    const rendered = renderBaseTemplate({
      headerTitle: 'Test notice',
      bodyHtml: '<p>Body HTML</p>',
      bodyText: 'Body text',
      brandName: 'Patrol Evidence Platform',
      signatureName: 'Licence Administration',
      footerNote: 'Do not share keys.',
    });

    expect(rendered.subject).toBe('Test notice');
    expect(rendered.html).toContain('Patrol Evidence Platform');
    expect(rendered.html).toContain('Body HTML');
    expect(rendered.html).toContain('Licence Administration');
    expect(rendered.html).toContain('Do not share keys.');
    expect(rendered.text).toContain('Body text');
    expect(rendered.text).toContain('Kind regards,');
  });

  it('renders licence issued template with activation details and no TG1 in body', () => {
    const rendered = renderLicenceIssuedTemplate({
      contactName: 'Alex Manager',
      companyName: 'ABC Security Ltd',
      licenseId: 'PEL-2026-000001',
      plan: 'ANNUAL',
      startsAtDisplay: '21/07/2026',
      expiresAtDisplay: '20/07/2027',
      maxDevices: 2,
      featuresDisplay: 'Evidence Collector',
      activationInstructions: '1. Open Patrol Evidence Platform.\n2. Activate licence.',
      supportEmail: 'support@techguards.co.uk',
      fromName: 'Patrol Licence Portal',
      attachmentFilename: 'PEL-2026-000001.lic',
      adminNote: 'Please activate today.',
    });

    expect(rendered.subject).toBe(buildDefaultLicenceIssuedSubject('PEL-2026-000001'));
    expect(rendered.html).toContain('Alex Manager');
    expect(rendered.html).toContain('ABC Security Ltd');
    expect(rendered.html).toContain('PEL-2026-000001');
    expect(rendered.html).toContain('ANNUAL');
    expect(rendered.html).toContain('21/07/2026');
    expect(rendered.html).toContain('20/07/2027');
    expect(rendered.html).toContain('PEL-2026-000001.lic');
    expect(rendered.html).toContain('Please activate today.');
    expect(rendered.html).toContain('Activate licence');
    expect(rendered.text).toContain('Licence ID:\nPEL-2026-000001');
    expect(rendered.html).not.toContain('TG1.');
    expect(rendered.text).not.toContain('TG1.');
  });

  it('escapes HTML in template fields', () => {
    const rendered = renderLicenceIssuedTemplate({
      contactName: '<script>alert(1)</script>',
      companyName: 'Co',
      licenseId: 'PEL-2026-000002',
      plan: 'TRIAL',
      startsAtDisplay: '01/01/2026',
      expiresAtDisplay: '01/01/2027',
      maxDevices: 1,
      activationInstructions: 'Paste key <here>',
      supportEmail: 'support@example.com',
      fromName: 'Portal',
      attachmentFilename: 'PEL-2026-000002.lic',
    });

    expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
  });
});

describe('NotificationType enum surface', () => {
  it('includes planned notification types including LICENSE_ISSUED', () => {
    expect(NotificationType.LICENSE_ISSUED).toBe('LICENSE_ISSUED');
    expect(NotificationType.PASSWORD_RESET).toBe('PASSWORD_RESET');
    expect(NotificationType.ADMIN_ALERT).toBe('ADMIN_ALERT');
  });
});
