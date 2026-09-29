import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'crypto';
import { SigningService } from '@/signing/signing.service';

describe('SigningService production rules', () => {
  function config(values: Record<string, string | undefined>) {
    return {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = values[key];
        if (value === undefined) throw new Error(`missing ${key}`);
        return value;
      }),
    };
  }

  it('allows missing key in test mode without throwing on init', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SigningService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'NODE_ENV') return 'test';
              if (key === 'LICENSE_SIGNING_KEY_ID') return 'test-key';
              return undefined;
            },
            getOrThrow: (key: string) => {
              if (key === 'LICENSE_SIGNING_KEY_ID') return 'test-key';
              throw new Error(`missing ${key}`);
            },
          },
        },
      ],
    }).compile();

    const service = module.get(SigningService);
    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.isReady()).toBe(false);
  });

  it('does not read a legacy key when issuance is explicitly disabled in production', () => {
    const configured = config({
      NODE_ENV: 'production',
      LICENSE_LEGACY_ISSUANCE_ENABLED: 'false',
    });
    const service = new SigningService(configured as unknown as ConfigService);

    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.isReady()).toBe(false);
    expect(configured.getOrThrow).not.toHaveBeenCalled();
    expect(configured.get).not.toHaveBeenCalledWith('LICENSE_PRIVATE_KEY');
    expect(configured.get).not.toHaveBeenCalledWith('LICENSE_PRIVATE_KEY_FILE');
    expect(() => service.signPayload({} as never)).toThrow('Legacy licence issuance is disabled');
  });

  it('keeps legacy issuance fail-closed when enabled without a private key', () => {
    const configured = config({
      NODE_ENV: 'production',
      LICENSE_LEGACY_ISSUANCE_ENABLED: 'true',
      LICENSE_SIGNING_KEY_ID: 'vesoft-offline-v1',
    });
    const service = new SigningService(configured as unknown as ConfigService);

    expect(() => service.onModuleInit()).toThrow(
      'LICENSE_PRIVATE_KEY or LICENSE_PRIVATE_KEY_FILE must be set',
    );
  });

  it('retains valid authorised legacy signing configuration when enabled', () => {
    const privateKey = generateKeyPairSync('ed25519').privateKey
      .export({ type: 'pkcs8', format: 'pem' }).toString();
    const configured = config({
      NODE_ENV: 'production',
      LICENSE_LEGACY_ISSUANCE_ENABLED: 'true',
      LICENSE_SIGNING_KEY_ID: 'vesoft-offline-v1',
      LICENSE_PRIVATE_KEY: privateKey,
    });
    const service = new SigningService(configured as unknown as ConfigService);

    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.isReady()).toBe(true);
    expect(service.getSigningKeyId()).toBe('vesoft-offline-v1');
  });
});
