import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { effectiveCommercialMode } from './commercial-mode';
import {
  COMMERCIAL_PRODUCTION_SIGNING_KEY_ID,
  COMMERCIAL_PRODUCTION_SIGNING_PROVIDER_ID,
  ProductionFileEd25519SigningProvider,
  type ProductionSignerPreflightResult,
} from './production-file-ed25519-signing.provider';

@Injectable()
export class CommercialProductionSignerPreflightService {
  private readonly logger = new Logger(CommercialProductionSignerPreflightService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly signer: ProductionFileEd25519SigningProvider,
  ) {}

  async verify(): Promise<void> {
    if (!this.isEnabled()) return;
    const result = await this.signer.preflight();
    const output = this.safeOutput(result);
    if (!result.passed) {
      this.logger.error(output);
      throw new Error('COMMERCIAL_PRODUCTION_SIGNER_PREFLIGHT_FAILED');
    }
    this.logger.log(output);
  }

  private isEnabled(): boolean {
    return effectiveCommercialMode({
      COMMERCIAL_MODE: this.config.get<string>('COMMERCIAL_MODE'),
      COMMERCIAL_STRIPE_ENABLED: this.config.get<string>('COMMERCIAL_STRIPE_ENABLED'),
      NODE_ENV: this.config.get<string>('NODE_ENV'),
      PATROLSAFE_COMMERCIAL_STAGING: this.config.get<string>('PATROLSAFE_COMMERCIAL_STAGING'),
    }) === 'PRODUCTION_LIVE';
  }

  private safeOutput(result: ProductionSignerPreflightResult): string {
    return [
      'COMMERCIAL_PRODUCTION_SIGNER_PREFLIGHT',
      `modeValid=${result.modeValid}`,
      `provider=${COMMERCIAL_PRODUCTION_SIGNING_PROVIDER_ID}`,
      `providerValid=${result.providerValid}`,
      `keyId=${COMMERCIAL_PRODUCTION_SIGNING_KEY_ID}`,
      `keyIdValid=${result.keyIdValid}`,
      `keyPathValid=${result.keyPathValid}`,
      `fingerprintConfigured=${result.fingerprintConfigured}`,
      `fileReadable=${result.fileReadable}`,
      `keyParseValid=${result.keyParseValid}`,
      `keyTypeValid=${result.keyTypeValid}`,
      `publicKeySha256=${result.publicKeySha256}`,
      `publicKeyMatch=${result.publicKeyMatch}`,
      `stagingKeyRejected=${result.stagingKeyRejected}`,
      `result=${result.passed ? 'PASS' : 'FAIL'}`,
    ].join('\n');
  }
}
