import { SettingsController } from './settings.controller';
import { SigningService } from '@/signing/signing.service';
import { EmailProvider } from '@/notifications/providers/email.provider';

describe('SettingsController', () => {
  it('returns only safe signing-key metadata', () => {
    const signingService = {
      getSigningKeyStatus: () => ({
        keyId: 'primary-2026',
        ready: true,
        algorithm: 'Ed25519' as const,
      }),
    } as Pick<SigningService, 'getSigningKeyStatus'>;
    const emailProvider = {} as EmailProvider;

    const controller = new SettingsController(signingService as SigningService, emailProvider);
    const status = controller.getSigningKeyStatus();

    expect(status).toEqual({
      keyId: 'primary-2026',
      ready: true,
      algorithm: 'Ed25519',
    });

    const serialized = JSON.stringify(status);
    expect(serialized).not.toMatch(/BEGIN (PRIVATE|PUBLIC) KEY/);
    expect(serialized).not.toMatch(/privateKey|publicKey|encryption|LICENSE_|pem|filesystem|path/i);
    expect(Object.keys(status).sort()).toEqual(['algorithm', 'keyId', 'ready']);
  });
});
