import { Injectable } from '@nestjs/common';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

export const COMMERCIAL_LICENCE_ISSUER = Symbol('COMMERCIAL_LICENCE_ISSUER');

export interface IssueCommercialLicenceCommand {
  commandId: string;
  correlationId: string;
  publicOrderId: string;
  requestHash: string;
  product: 'Patrol Evidence Platform';
  plan: 'annual';
  installationId: string;
  machineFingerprint: string;
  companyName: string;
  startsAt: string;
  expiresAt: string;
  maxDevices: 1;
  predecessorLicenceId: string | null;
}

export interface IssueCommercialLicenceResult {
  licenceId: string;
  payloadHash: string;
  signingKeyId: string;
  artifact: {
    artifactId: string;
    fileName: string;
    storageKey: string;
    sha256: string;
    byteSize: bigint;
    contentType: 'application/json';
  };
}

export interface CommercialLicenceIssuer {
  issue(command: Readonly<IssueCommercialLicenceCommand>): Promise<IssueCommercialLicenceResult>;
}

/** Phase 1 production binding: deliberately incapable of loading a key or signing. */
@Injectable()
export class DisabledCommercialLicenceIssuer implements CommercialLicenceIssuer {
  async issue(_command: Readonly<IssueCommercialLicenceCommand>): Promise<IssueCommercialLicenceResult> {
    void _command;
    throw new ApiException(
      ERROR_CODES.COMMERCIAL_ISSUER_DISABLED,
      'Commercial licence issuance is disabled in Phase 1.',
      503,
    );
  }
}
