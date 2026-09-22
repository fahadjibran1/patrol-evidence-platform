import { AuditService } from './audit.service';

describe('AuditService', () => {
  const service = new AuditService({ auditLog: { create: jest.fn() } } as never);

  it('sanitizes existing sensitive metadata fields', () => {
    expect(service.sanitizeMetadata({
      password: 'secret',
      signedLicenseKey: 'TG1.payload.signature',
      licenseId: 'PEL-2026-000001',
    })).toEqual({ licenseId: 'PEL-2026-000001' });
  });

  it('removes commercial secrets and workstation fingerprints', () => {
    expect(service.sanitizeMetadata({
      safe: 'ok',
      machineFingerprint: 'sensitive',
      bearerToken: 'sensitive',
      paymentSecret: 'sensitive',
      artifactContent: 'sensitive',
      licence: 'TG1.sensitive',
    })).toEqual({ safe: 'ok', licence: '[redacted-licence-key]' });
  });
});
