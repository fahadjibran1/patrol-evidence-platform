import { ConfigService } from '@nestjs/config';
import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'crypto';
import { constants } from 'fs';
import { access, readFile } from 'fs/promises';
import { isAbsolute, relative, resolve, sep } from 'path';
import type { CommercialSigningProvider } from './commercial-signing-provider.port';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { effectiveCommercialMode } from './commercial-mode';

export const COMMERCIAL_PRODUCTION_SIGNING_PROVIDER_ID = 'secret-file-ed25519-v1';
export const COMMERCIAL_PRODUCTION_SIGNING_KEY_ID = 'vesoft-online-v1';
export const COMMERCIAL_PRODUCTION_SIGNING_KEY_PATH = '/etc/secrets/patrolsafe-production-ed25519-private.pem';
export const COMMERCIAL_STAGING_PUBLIC_KEY_SHA256 = '688340412959FBC23E8C3F0CB17BC6CFC2EE121254ACE2256D66216B2A512582';

export interface ProductionSignerPreflightResult {
  modeValid: boolean;
  providerValid: boolean;
  keyIdValid: boolean;
  keyPathValid: boolean;
  fingerprintConfigured: boolean;
  fileReadable: boolean;
  keyParseValid: boolean;
  keyTypeValid: boolean;
  publicKeySha256: string;
  publicKeyMatch: boolean;
  stagingKeyRejected: boolean;
  passed: boolean;
}

/**
 * Initial low-volume production adapter. Private material remains behind this
 * interface so a managed/HSM adapter can replace it without changing licences.
 */
export class ProductionFileEd25519SigningProvider implements CommercialSigningProvider {
  readonly keyId: string;
  private privateKey: KeyObject | null = null;
  private publicKey: KeyObject | null = null;

  constructor(private readonly config: ConfigService) {
    this.keyId = this.config.get<string>('COMMERCIAL_PRODUCTION_SIGNING_KEY_ID')?.trim() ?? '';
  }

  async sign(payload: Buffer): Promise<Buffer> {
    const privateKey = this.assertReady();
    const signature = sign(null, payload, privateKey);
    if (!verify(null, payload, this.publicKey!, signature)) {
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_LICENCE_VERIFICATION_FAILED,
        'Production signing result failed independent verification.',
        500,
      );
    }
    return signature;
  }

  async verificationKey(): Promise<KeyObject> {
    this.assertReady();
    return this.publicKey!;
  }

  async preflight(keyPathPolicy = COMMERCIAL_PRODUCTION_SIGNING_KEY_PATH): Promise<ProductionSignerPreflightResult> {
    const provider = this.config.get<string>('COMMERCIAL_PRODUCTION_SIGNING_PROVIDER')?.trim() ?? '';
    const configuredPath = this.config.get<string>('COMMERCIAL_PRODUCTION_SIGNING_PRIVATE_KEY_FILE')?.trim() ?? '';
    const expectedFingerprint = this.config.get<string>('COMMERCIAL_PRODUCTION_SIGNING_PUBLIC_KEY_SHA256')
      ?.trim().toUpperCase() ?? '';
    const result: ProductionSignerPreflightResult = {
      modeValid: this.config.get<string>('NODE_ENV') === 'production'
        && effectiveCommercialMode({
          COMMERCIAL_MODE: this.config.get<string>('COMMERCIAL_MODE'),
          COMMERCIAL_STRIPE_ENABLED: this.config.get<string>('COMMERCIAL_STRIPE_ENABLED'),
          NODE_ENV: this.config.get<string>('NODE_ENV'),
          PATROLSAFE_COMMERCIAL_STAGING: this.config.get<string>('PATROLSAFE_COMMERCIAL_STAGING'),
        }) === 'PRODUCTION_LIVE',
      providerValid: provider === COMMERCIAL_PRODUCTION_SIGNING_PROVIDER_ID,
      keyIdValid: this.keyId === COMMERCIAL_PRODUCTION_SIGNING_KEY_ID,
      keyPathValid: configuredPath === keyPathPolicy,
      fingerprintConfigured: /^[0-9A-F]{64}$/.test(expectedFingerprint)
        && !/^0{64}$/.test(expectedFingerprint)
        && expectedFingerprint !== COMMERCIAL_STAGING_PUBLIC_KEY_SHA256,
      fileReadable: false,
      keyParseValid: false,
      keyTypeValid: false,
      publicKeySha256: 'UNAVAILABLE',
      publicKeyMatch: false,
      stagingKeyRejected: true,
      passed: false,
    };

    if (!result.modeValid || !result.providerValid || !result.keyIdValid || !result.keyPathValid || !result.fingerprintConfigured) {
      return result;
    }

    let keyBytes: Buffer | undefined;
    try {
      if (!isAbsolute(configuredPath) || this.isWithinRepository(configuredPath)) return result;
      await access(configuredPath, constants.R_OK);
      keyBytes = await readFile(configuredPath);
      result.fileReadable = true;
      const privateKey = createPrivateKey(keyBytes);
      result.keyParseValid = true;
      result.keyTypeValid = privateKey.asymmetricKeyType === 'ed25519';
      if (!result.keyTypeValid) return result;
      const publicKey = createPublicKey(privateKey);
      const publicDer = publicKey.export({ type: 'spki', format: 'der' });
      result.publicKeySha256 = createHash('sha256').update(publicDer).digest('hex').toUpperCase();
      result.stagingKeyRejected = result.publicKeySha256 !== COMMERCIAL_STAGING_PUBLIC_KEY_SHA256;
      result.publicKeyMatch = result.publicKeySha256 === expectedFingerprint;
      result.passed = result.stagingKeyRejected && result.publicKeyMatch;
      if (result.passed) {
        this.privateKey = privateKey;
        this.publicKey = publicKey;
      }
      return result;
    } catch {
      return result;
    } finally {
      keyBytes?.fill(0);
    }
  }

  private assertReady(): KeyObject {
    if (!this.privateKey || !this.publicKey) {
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_ISSUER_DISABLED,
        'Production commercial signing is unavailable.',
        503,
      );
    }
    return this.privateKey;
  }

  private isWithinRepository(file: string): boolean {
    const fromRepository = relative(resolve(process.cwd()), resolve(file));
    return fromRepository !== '..' && !fromRepository.startsWith(`..${sep}`);
  }
}
