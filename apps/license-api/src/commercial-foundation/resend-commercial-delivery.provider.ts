import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import type { CommercialDeliveryProvider, CommercialDeliveryProviderEvent, SendCommercialLicenceEmailCommand } from './commercial-delivery-provider.port';
import { renderCommercialLicenceEmail } from './commercial-licence-email.template';

export class ResendCommercialDeliveryProvider implements CommercialDeliveryProvider {
  readonly name = 'resend' as const;

  constructor(private readonly config: ConfigService) {}

  async send(command: Readonly<SendCommercialLicenceEmailCommand>): Promise<{ messageId: string; acceptedAt: Date }> {
    const configuration = this.sendConfiguration();
    const template = renderCommercialLicenceEmail(command);
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${configuration.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': command.idempotencyKey,
        },
        body: JSON.stringify({
          from: configuration.from,
          to: [command.recipient],
          subject: template.subject,
          html: template.html,
          text: template.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_FAILED, 'Licence email provider is temporarily unavailable.', 503);
    }
    if (!response.ok) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_FAILED, 'Licence email provider rejected the request.', 503);
    }
    const result = await response.json() as { id?: unknown };
    if (typeof result.id !== 'string' || !/^[-_A-Za-z0-9]{6,200}$/.test(result.id)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_FAILED, 'Licence email provider returned an invalid response.', 503);
    }
    return { messageId: result.id, acceptedAt: new Date() };
  }

  verifyWebhook(rawBody: Buffer, headers: Readonly<Record<string, string | undefined>>): CommercialDeliveryProviderEvent {
    const secret = this.config.get<string>('COMMERCIAL_RESEND_WEBHOOK_SECRET')?.trim() ?? '';
    const eventId = headers['svix-id']?.trim() ?? '';
    const timestamp = headers['svix-timestamp']?.trim() ?? '';
    const signatureHeader = headers['svix-signature']?.trim() ?? '';
    if (!secret.startsWith('whsec_') || !eventId || !/^\d{10}$/.test(timestamp) || !signatureHeader) this.invalidWebhook();
    const eventTime = Number(timestamp) * 1000;
    if (!Number.isFinite(eventTime) || Math.abs(Date.now() - eventTime) > 5 * 60_000) this.invalidWebhook();
    let key: Buffer;
    try { key = Buffer.from(secret.slice(6), 'base64'); } catch { return this.invalidWebhook(); }
    if (key.length < 16) this.invalidWebhook();
    const expected = createHmac('sha256', key).update(`${eventId}.${timestamp}.${rawBody.toString('utf8')}`).digest();
    const signatures = signatureHeader.split(' ').map((item) => item.split(',', 2)).filter(([version]) => version === 'v1');
    const valid = signatures.some(([, encoded]) => {
      try { const actual = Buffer.from(encoded, 'base64'); return actual.length === expected.length && timingSafeEqual(actual, expected); } catch { return false; }
    });
    if (!valid) this.invalidWebhook();
    let body: unknown;
    try { body = JSON.parse(rawBody.toString('utf8')); } catch { return this.invalidWebhook(); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return this.invalidWebhook();
    const value = body as { type?: unknown; created_at?: unknown; data?: { email_id?: unknown } };
    const allowed = new Set(['email.sent', 'email.delivered', 'email.bounced', 'email.complained', 'email.failed']);
    if (typeof value.type !== 'string' || !allowed.has(value.type) || typeof value.data?.email_id !== 'string') return this.invalidWebhook();
    const occurredAt = typeof value.created_at === 'string' ? new Date(value.created_at) : new Date(eventTime);
    if (Number.isNaN(occurredAt.getTime())) return this.invalidWebhook();
    return { eventId, messageId: value.data.email_id, type: value.type as CommercialDeliveryProviderEvent['type'], occurredAt };
  }

  private sendConfiguration() {
    if (this.config.get<string>('COMMERCIAL_RESEND_ENABLED') !== 'true') {
      throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_PROVIDER_DISABLED, 'Commercial licence email delivery is disabled.', 503);
    }
    const apiKey = this.config.get<string>('COMMERCIAL_RESEND_API_KEY')?.trim() ?? '';
    const from = this.config.get<string>('COMMERCIAL_RESEND_FROM')?.trim() ?? '';
    if (!apiKey.startsWith('re_') || !/^.+<[^<>@\s]+@[^<>@\s]+>$/.test(from)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_PROVIDER_DISABLED, 'Commercial licence email delivery is not configured.', 503);
    }
    return { apiKey, from };
  }

  private invalidWebhook(): never {
    throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_WEBHOOK_INVALID, 'Delivery provider webhook is invalid.', 400);
  }
}
