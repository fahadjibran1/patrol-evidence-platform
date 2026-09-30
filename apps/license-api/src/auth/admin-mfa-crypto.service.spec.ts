import { ConfigService } from '@nestjs/config';
import { AdminMfaCryptoService } from './admin-mfa-crypto.service';

describe('AdminMfaCryptoService', () => {
  const service = new AdminMfaCryptoService(new ConfigService({
    ADMIN_MFA_ENCRYPTION_KEY: 'A'.repeat(64),
  }));

  it('encrypts MFA secrets with authenticated encryption and never stores plaintext', () => {
    const secret = service.generateSecret();
    const encrypted = service.encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(service.decryptSecret(encrypted)).toBe(secret);
    expect(() => service.decryptSecret(encrypted.replace(/.$/, '0'))).toThrow();
  });

  it('verifies a current TOTP and rejects malformed and expired values', () => {
    const secret = service.generateSecret();
    const now = 1_800_000_000_000;
    const counter = Math.floor(now / 1000 / 30);
    const code = (service as unknown as { totp(value: string, valueCounter: number): string })
      .totp(secret, counter);
    expect(service.verifyTotp(secret, code, now)).toBe(counter);
    expect(service.verifyTotp(secret, code, now + 120_000)).toBeNull();
    expect(service.verifyTotp(secret, 'not-a-code', now)).toBeNull();
  });

  it('creates one-time recovery material that is only retained as a keyed hash', () => {
    const codes = service.generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const hash = service.hashRecoveryCode(codes[0]);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(codes[0]);
    expect(service.hashRecoveryCode(codes[0].toLowerCase().replace(/-/g, ''))).toBe(hash);
  });

  it('fails closed without the dedicated encryption key', () => {
    const unavailable = new AdminMfaCryptoService(new ConfigService({}));
    expect(unavailable.isConfigured()).toBe(false);
    expect(() => unavailable.generateSecret()).toThrow('ADMIN_MFA_ENCRYPTION_KEY');
  });
});
