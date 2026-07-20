import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import {
  assertEd25519PrivateKey,
  createSignedLicenseKey,
  derivePublicKeyFromPrivate,
  hashLicensePayload,
  verifySignedLicenseKey,
  type LicensePayload,
} from '@patrol/license-core';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

export interface SignedLicenceResult {
  signedLicenseKey: string;
  payloadHash: string;
  signingKeyId: string;
}

@Injectable()
export class SigningService implements OnModuleInit {
  private readonly logger = new Logger(SigningService.name);
  private privateKeyPem: string | null = null;
  private publicKey: ReturnType<typeof derivePublicKeyFromPrivate> | null = null;
  private signingKeyId: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
    this.signingKeyId = this.configService.getOrThrow<string>('LICENSE_SIGNING_KEY_ID');

    try {
      this.privateKeyPem = this.loadPrivateKeyPem(nodeEnv);
      assertEd25519PrivateKey(this.privateKeyPem);
      this.publicKey = derivePublicKeyFromPrivate(this.privateKeyPem);
      this.logger.log(`LICENSE_SIGNING_KEY_READY keyId=${this.signingKeyId}`);
    } catch (error) {
      if (nodeEnv === 'test') {
        this.logger.warn('Signing key not loaded in test mode; call useTestKey() in tests');
        return;
      }
      if (nodeEnv === 'production') {
        throw error;
      }
      this.logger.warn(
        `Signing key not configured (${error instanceof Error ? error.message : String(error)}); licence issuance will fail until configured`,
      );
    }
  }

  useTestKey(privateKeyPem: string, keyId = 'test-key'): void {
    assertEd25519PrivateKey(privateKeyPem);
    this.privateKeyPem = privateKeyPem;
    this.publicKey = derivePublicKeyFromPrivate(privateKeyPem);
    this.signingKeyId = keyId;
  }

  isReady(): boolean {
    return Boolean(this.privateKeyPem && this.publicKey && this.signingKeyId);
  }

  getSigningKeyId(): string {
    return this.signingKeyId ?? 'unknown';
  }

  signPayload(payload: LicensePayload): SignedLicenceResult {
    if (!this.privateKeyPem || !this.publicKey || !this.signingKeyId) {
      throw new ApiException(
        ERROR_CODES.LICENCE_SIGNING_KEY_MISSING,
        'Licence signing key is not configured',
        503,
      );
    }

    let signedLicenseKey: string;
    try {
      signedLicenseKey = createSignedLicenseKey(payload, this.privateKeyPem);
    } catch {
      throw new ApiException(ERROR_CODES.LICENCE_SIGNING_FAILED, 'Failed to sign licence payload', 500);
    }

    const verification = verifySignedLicenseKey({
      licenseKey: signedLicenseKey,
      publicKey: this.publicKey,
      today: payload.startsAt,
    });

    if (!verification.signatureValid || !verification.payload) {
      throw new ApiException(
        ERROR_CODES.LICENCE_GENERATED_VERIFICATION_FAILED,
        'Generated licence failed verification before save',
        500,
      );
    }

    return {
      signedLicenseKey,
      payloadHash: hashLicensePayload(payload),
      signingKeyId: this.signingKeyId,
    };
  }

  private loadPrivateKeyPem(nodeEnv: string): string {
    const inline = this.configService.get<string>('LICENSE_PRIVATE_KEY')?.trim();
    if (inline) {
      return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
    }

    const filePath = this.configService.get<string>('LICENSE_PRIVATE_KEY_FILE')?.trim();
    if (filePath && existsSync(filePath)) {
      return readFileSync(filePath, 'utf8');
    }

    if (nodeEnv === 'test') {
      throw new Error('Test signing key must be injected via useTestKey()');
    }

    throw new Error(
      'LICENSE_PRIVATE_KEY or LICENSE_PRIVATE_KEY_FILE must be set with a valid Ed25519 private key',
    );
  }
}
