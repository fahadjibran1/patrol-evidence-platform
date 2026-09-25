import { ConfigService } from '@nestjs/config';
import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'crypto';
import { constants } from 'fs';
import { access, readFile } from 'fs/promises';
import { isAbsolute, relative, resolve, sep } from 'path';
import type { CommercialSigningProvider } from './commercial-signing-provider.port';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

export interface CommercialSignerPreflightPolicy {
  keyId: string;
  keyPath: string;
  publicKeySha256: string;
}

export interface CommercialSignerPreflightResult {
  keyIdValid: boolean;
  keyPathValid: boolean;
  fileReadable: boolean;
  keyParseValid: boolean;
  keyTypeValid: boolean;
  publicKeySha256: string;
  publicKeyMatch: boolean;
  passed: boolean;
}

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

  async preflight(policy: Readonly<CommercialSignerPreflightPolicy>): Promise<CommercialSignerPreflightResult> {
    const configuredPath = this.config.get<string>('COMMERCIAL_TEST_SIGNING_PRIVATE_KEY_FILE')?.trim() ?? '';
    const result: CommercialSignerPreflightResult = {
      keyIdValid: this.keyId === policy.keyId,
      keyPathValid: configuredPath === policy.keyPath,
      fileReadable: false,
      keyParseValid: false,
      keyTypeValid: false,
      publicKeySha256: 'UNAVAILABLE',
      publicKeyMatch: false,
      passed: false,
    };

    if (!result.keyIdValid || !result.keyPathValid) return result;

    let keyBytes: Buffer | undefined;
    try {
      await access(policy.keyPath, constants.R_OK);
      keyBytes = await readFile(policy.keyPath);
      result.fileReadable = true;
      const key = createPrivateKey(keyBytes);
      result.keyParseValid = true;
      result.keyTypeValid = key.asymmetricKeyType === 'ed25519';
      if (!result.keyTypeValid) return result;

      const publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' });
      result.publicKeySha256 = createHash('sha256').update(publicKey).digest('hex').toUpperCase();
      result.publicKeyMatch = result.publicKeySha256 === policy.publicKeySha256;
      result.passed = result.publicKeyMatch;
      if (result.passed) this.privateKey = key;
      return result;
    } catch {
      return result;
    } finally {
      keyBytes?.fill(0);
    }
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
