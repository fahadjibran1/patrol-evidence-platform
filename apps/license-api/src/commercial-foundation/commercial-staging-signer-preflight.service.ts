import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type CommercialSignerPreflightResult,
  TestFileEd25519SigningProvider,
} from './test-file-ed25519-signing.provider';

export const COMMERCIAL_STAGING_SIGNER_POLICY = Object.freeze({
  keyId: 'test-phase6-online-key',
  keyPath: '/etc/secrets/patrolsafe-staging-ed25519-private.pem',
  publicKeySha256: '688340412959FBC23E8C3F0CB17BC6CFC2EE121254ACE2256D66216B2A512582',
});

@Injectable()
export class CommercialStagingSignerPreflightService {
  private readonly logger = new Logger(CommercialStagingSignerPreflightService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly signer: TestFileEd25519SigningProvider,
  ) {}

  async verify(): Promise<void> {
    if (!this.isEnabled()) return;

    const result = await this.signer.preflight(COMMERCIAL_STAGING_SIGNER_POLICY);
    const output = this.safeOutput(result);
    if (!result.passed) {
      this.logger.error(output);
      throw new Error('COMMERCIAL_SIGNER_PREFLIGHT_FAILED');
    }
    this.logger.log(output);
  }

  private isEnabled(): boolean {
    return this.config.get<string>('NODE_ENV') === 'staging'
      && this.config.get<string>('PATROLSAFE_COMMERCIAL_STAGING') === 'true'
      && this.config.get<string>('COMMERCIAL_TEST_ISSUER_ENABLED') === 'true';
  }

  private safeOutput(result: CommercialSignerPreflightResult): string {
    return [
      'COMMERCIAL_SIGNER_PREFLIGHT',
      `keyId=${COMMERCIAL_STAGING_SIGNER_POLICY.keyId}`,
      `keyIdValid=${result.keyIdValid}`,
      `keyPathValid=${result.keyPathValid}`,
      `fileReadable=${result.fileReadable}`,
      `keyParseValid=${result.keyParseValid}`,
      `keyTypeValid=${result.keyTypeValid}`,
      `publicKeySha256=${result.publicKeySha256}`,
      `publicKeyMatch=${result.publicKeyMatch}`,
      `result=${result.passed ? 'PASS' : 'FAIL'}`,
    ].join('\n');
  }
}
