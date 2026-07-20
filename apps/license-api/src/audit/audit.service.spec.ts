import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('sanitizes sensitive metadata fields', () => {
    const service = new AuditService({ auditLog: { create: jest.fn() } } as never);
    const sanitized = service.sanitizeMetadata({
      password: 'secret',
      signedLicenseKey: 'TG1.payload.signature',
      licenseId: 'PEL-2026-000001',
    });

    expect(sanitized).toEqual({
      licenseId: 'PEL-2026-000001',
    });
  });
});
