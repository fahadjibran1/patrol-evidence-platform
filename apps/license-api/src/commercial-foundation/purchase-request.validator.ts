import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { canonicalizeJson } from '@patrol/license-core';
import { createHash } from 'crypto';
import {
  PurchaseRequestV2Dto,
  type CanonicalPurchaseRequestV2,
} from './dto/purchase-request-v2.dto';
import { COMMERCIAL_PRODUCT } from './commercial.constants';

@Injectable()
export class PurchaseRequestValidator {
  async validate(input: unknown): Promise<{
    request: CanonicalPurchaseRequestV2;
    canonicalJson: string;
    canonicalHash: string;
  }> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw this.invalid('Purchase request must be a JSON object.');
    }

    const dto = plainToInstance(PurchaseRequestV2Dto, input);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    });
    if (errors.length > 0) {
      const fields = errors.map((error) => error.property).sort().join(', ');
      throw this.invalid(`Purchase request validation failed for: ${fields}.`);
    }

    const request: CanonicalPurchaseRequestV2 = {
      requestId: dto.requestId.toLowerCase(),
      schemaVersion: dto.schemaVersion,
      product: COMMERCIAL_PRODUCT,
      plan: dto.plan,
      installationId: dto.installationId.toLowerCase(),
      machineFingerprint: dto.machineFingerprint.toLowerCase(),
      companyName: dto.companyName,
      appVersion: dto.appVersion,
      buildId: dto.buildId,
      clientNonce: dto.clientNonce,
      previousLicenceId: dto.previousLicenceId?.toLowerCase() ?? null,
    };
    const canonicalJson = canonicalizeJson(request);
    return {
      request,
      canonicalJson,
      canonicalHash: createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
    };
  }

  private invalid(message: string): ApiException {
    return new ApiException(ERROR_CODES.COMMERCIAL_REQUEST_INVALID, message, 400);
  }
}
