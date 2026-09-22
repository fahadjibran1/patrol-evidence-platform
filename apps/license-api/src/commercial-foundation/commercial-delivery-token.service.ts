import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

@Injectable()
export class CommercialDeliveryTokenService {
  static readonly PURPOSE = 'licence-download';
  static readonly LIFETIME_MS = 24 * 60 * 60_000;

  constructor(private readonly config: ConfigService) {}

  derive(attemptId: string): { raw: string; hash: string } {
    const key = this.key();
    const raw = createHmac('sha256', key).update(`patrolsafe-commercial-delivery:v1:${attemptId}`).digest('base64url');
    return { raw, hash: this.hash(raw) };
  }

  hash(raw: string): string {
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  expiresAt(createdAt: Date): Date {
    return new Date(createdAt.getTime() + CommercialDeliveryTokenService.LIFETIME_MS);
  }

  downloadUrl(raw: string): string {
    const configured = this.config.get<string>('COMMERCIAL_LICENCE_DOWNLOAD_BASE_URL')?.trim() ?? '';
    let base: URL;
    try { base = new URL(configured); } catch { throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_PROVIDER_DISABLED, 'Commercial licence download URL is not configured.', 503); }
    const environment = this.config.get<string>('NODE_ENV') ?? 'development';
    if (environment === 'production' && base.protocol !== 'https:') {
      throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_PROVIDER_DISABLED, 'Commercial licence download URL must use HTTPS.', 503);
    }
    base.pathname = `${base.pathname.replace(/\/$/, '')}/${raw}`;
    base.search = '';
    base.hash = '';
    return base.toString();
  }

  private key(): Buffer {
    const encoded = this.config.get<string>('COMMERCIAL_DELIVERY_TOKEN_SECRET')?.trim() ?? '';
    let key: Buffer;
    try { key = Buffer.from(encoded, 'base64'); } catch { key = Buffer.alloc(0); }
    if (key.length < 32) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_PROVIDER_DISABLED, 'Commercial delivery token service is not configured.', 503);
    }
    return key;
  }
}
