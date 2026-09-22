import { createHash } from 'crypto';
import {
  canonicalizeCommercialPayload,
  serializeSignedCommercialLicence,
  verifyCommercialLicence,
  type CommercialLicencePayload,
  type SignedCommercialLicence,
} from '@patrol/license-core';
import type { CommercialLicenceIssuer, IssueCommercialLicenceCommand, IssueCommercialLicenceResult } from './commercial-issuer.port';
import type { CommercialSigningProvider } from './commercial-signing-provider.port';
import type { CommercialArtifactStore } from './commercial-artifact-store.port';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

export class CurrentFormatCommercialLicenceIssuer implements CommercialLicenceIssuer {
  constructor(
    private readonly signing: CommercialSigningProvider,
    private readonly artifacts: CommercialArtifactStore,
  ) {}

  async issue(command: Readonly<IssueCommercialLicenceCommand>): Promise<IssueCommercialLicenceResult> {
    if (command.product !== 'Patrol Evidence Platform' || command.plan !== 'annual' || command.maxDevices !== 1) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUANCE_NOT_ALLOWED, 'Commercial licence policy is invalid.', 409);
    }
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(this.signing.keyId)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUER_DISABLED, 'Commercial signing key identity is invalid.', 503);
    }
    const payload: CommercialLicencePayload = {
      version: 1,
      licenceId: command.licenceId,
      installationId: command.installationId,
      machineFingerprint: command.machineFingerprint,
      companyName: command.companyName,
      plan: 'annual',
      issuedAt: command.issuedAt,
      startsAt: command.startsAt,
      expiresAt: command.expiresAt,
      features: { ...command.features },
      product: 'Patrol Evidence Platform',
      maxDevices: 1,
    };
    const canonical = canonicalizeCommercialPayload(payload);
    const signature = await this.signing.sign(Buffer.from(canonical, 'utf8'));
    const signed: SignedCommercialLicence = { payload, signature: signature.toString('base64url') };
    const verified = verifyCommercialLicence({
      licence: signed,
      publicKey: await this.signing.verificationKey(),
      installationId: command.installationId,
      machineFingerprint: command.machineFingerprint,
      today: command.startsAt,
      clockToleranceHours: 0,
    });
    if (!verified.valid || verified.payload?.product !== 'Patrol Evidence Platform') {
      throw new ApiException(ERROR_CODES.COMMERCIAL_LICENCE_VERIFICATION_FAILED, 'Generated licence failed independent verification.', 500);
    }
    const bytes = Buffer.from(serializeSignedCommercialLicence(signed), 'utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const payloadHash = createHash('sha256').update(canonical, 'utf8').digest('hex');
    const fileName = `PatrolSafe-Licence-${command.licenceId.slice(-12)}.tglic`;
    const stored = await this.artifacts.putImmutable({
      issuanceId: command.commandId,
      sha256,
      fileName,
      bytes,
    });
    return {
      licenceId: command.licenceId,
      payloadHash,
      signingKeyId: this.signing.keyId,
      artifact: {
        artifactId: `art_${sha256.slice(0, 32)}`,
        fileName,
        storageKey: stored.storageKey,
        sha256,
        byteSize: stored.byteSize,
        contentType: 'application/json',
      },
    };
  }
}
