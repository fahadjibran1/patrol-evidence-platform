import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SigningService } from '@/signing/signing.service';

describe('SigningService production rules', () => {
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
});
