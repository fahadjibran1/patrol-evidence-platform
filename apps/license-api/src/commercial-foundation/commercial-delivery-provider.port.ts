export const COMMERCIAL_DELIVERY_PROVIDER = Symbol('COMMERCIAL_DELIVERY_PROVIDER');

export interface SendCommercialLicenceEmailCommand {
  attemptId: string;
  idempotencyKey: string;
  recipient: string;
  companyName: string;
  startsAt: string;
  expiresAt: string;
  downloadUrl: string;
  linkExpiresAt: string;
}

export interface CommercialDeliveryProviderEvent {
  eventId: string;
  messageId: string;
  type: 'email.sent' | 'email.delivered' | 'email.bounced' | 'email.complained' | 'email.failed';
  occurredAt: Date;
}

export interface CommercialDeliveryProvider {
  readonly name: 'resend';
  send(command: Readonly<SendCommercialLicenceEmailCommand>): Promise<{ messageId: string; acceptedAt: Date }>;
  verifyWebhook(rawBody: Buffer, headers: Readonly<Record<string, string | undefined>>): CommercialDeliveryProviderEvent;
}
