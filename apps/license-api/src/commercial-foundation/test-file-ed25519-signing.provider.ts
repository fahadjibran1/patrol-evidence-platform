import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createPublicKey, sign, type KeyObject } from 'crypto';
import { readFile } from 'fs/promises';
import { isAbsolute, relative, resolve, sep } from 'path';
import type { CommercialSigningProvider } from './commercial-signing-provider.port';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

/** Test/development adapter only. Production is required to use a secret-manager-backed provider. */
export class TestFileEd25519SigningProvider implements CommercialSigningProvider {
  readonly keyId: string;
  private privateKey: KeyObject | null = null;

  constructor(private readonly config: ConfigService) {
    this.keyId = this.config.get<string>('COMMERCIAL_TEST_SIGNING_KEY_ID')?.trim() ?? '';
  }

  async sign(payload: Buffer): Promise<Buffer> {
    return sign(null, payload, await this.loadPrivateKey());
  }

  async verificationKey(): Promise<KeyObject> {
    return createPublicKey(await this.loadPrivateKey());
  }

  private async loadPrivateKey(): Promise<KeyObject> {
    if (this.privateKey) return this.privateKey;
    const env = this.config.get<string>('NODE_ENV') ?? 'development';
    const enabled = this.config.get<string>('COMMERCIAL_TEST_ISSUER_ENABLED') === 'true';
    const file = this.config.get<string>('COMMERCIAL_TEST_SIGNING_PRIVATE_KEY_FILE')?.trim() ?? '';
    if (env === 'production' || !enabled || !this.keyId.startsWith('test-')) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUER_DISABLED, 'Test commercial signing is disabled.', 503);
    }
    if (!file || !isAbsolute(file)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUER_DISABLED, 'An absolute external test signing-key path is required.', 503);
    }
    const absolute = resolve(file);
    const fromRepository = relative(resolve(process.cwd()), absolute);
    if (fromRepository !== '..' && !fromRepository.startsWith(`..${sep}`)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUER_DISABLED, 'Test signing key must be outside committed source.', 503);
    }
    const key = createPrivateKey(await readFile(absolute, 'utf8'));
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUER_DISABLED, 'Test signing key must be Ed25519.', 503);
    }
    this.privateKey = key;
    return key;
  }
}
