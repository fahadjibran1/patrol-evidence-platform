import { Inject, Injectable } from '@nestjs/common';
import {
  CommercialActorType,
  CommercialProvider,
  CommercialProviderEventStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import {
  COMMERCIAL_PAYMENT_PROVIDER,
  type CommercialPaymentProvider,
} from './commercial-payment-provider.port';
import { createCommercialAudit, createCommercialOutboxEvent } from './commercial-persistence.util';

@Injectable()
export class CommercialWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(COMMERCIAL_PAYMENT_PROVIDER) private readonly provider: CommercialPaymentProvider,
  ) {}

  async ingest(rawBody: Buffer, signature: string | undefined, correlationId = randomUUID()) {
    if (!signature?.trim()) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_WEBHOOK_INVALID, 'Stripe-Signature is required.', 400);
    }
    const verified = this.provider.verifyWebhook(rawBody, signature);
    if (verified.livemode || this.provider.getMode() !== 'TEST') {
      await this.auditService.record({
        actorType: 'PROVIDER',
        actorId: 'stripe',
        action: 'commercial.provider_event.mode_rejected',
        entityType: 'CommercialProviderEvent',
        correlationId,
        metadata: { providerEventId: verified.providerEventId, eventType: verified.type, livemode: verified.livemode },
      });
      throw new ApiException(ERROR_CODES.COMMERCIAL_WEBHOOK_MODE_MISMATCH, 'Stripe event mode is not accepted.', 400);
    }

    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    try {
      const stored = await this.prisma.$transaction(async (tx) => {
        const event = await tx.commercialProviderEvent.create({
          data: {
            provider: CommercialProvider.STRIPE,
            providerEventId: verified.providerEventId,
            eventType: verified.type,
            payloadHash,
            status: CommercialProviderEventStatus.RECEIVED,
            safeMetadata: this.safeMetadata(verified) as Prisma.InputJsonValue,
            correlationId,
            providerCreatedAt: verified.createdAt,
            livemode: false,
          },
        });
        await createCommercialAudit(tx, this.auditService, {
          actorType: CommercialActorType.PROVIDER,
          actorId: 'stripe',
          action: 'commercial.provider_event.received',
          entityType: 'CommercialProviderEvent',
          entityId: event.id,
          correlationId,
          metadata: {
            providerEventId: verified.providerEventId,
            eventType: verified.type,
            livemode: false,
            objectType: verified.objectType,
          },
        });
        await createCommercialOutboxEvent(tx, {
          idempotencyKey: `commercial-provider-event:${event.id}:received`,
          aggregateType: 'CommercialProviderEvent',
          aggregateId: event.id,
          eventType: 'commercial.provider_event.received',
          correlationId,
          payload: { providerEventId: event.id },
        });
        return event;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { received: true, duplicate: false, eventId: stored.id };
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;
      const existing = await this.prisma.commercialProviderEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider: CommercialProvider.STRIPE,
            providerEventId: verified.providerEventId,
          },
        },
      });
      if (!existing || existing.payloadHash !== payloadHash) {
        throw new ApiException(
          ERROR_CODES.COMMERCIAL_RECONCILIATION_MISMATCH,
          'Duplicate provider event identity has a different payload.',
          409,
        );
      }
      return { received: true, duplicate: true, eventId: existing.id };
    }
  }

  private safeMetadata(event: ReturnType<CommercialPaymentProvider['verifyWebhook']>): Record<string, unknown> {
    return {
      objectId: event.objectId,
      objectType: event.objectType,
      publicOrderId: event.publicOrderId,
      checkoutSessionId: event.checkoutSessionId,
      paymentIntentId: event.paymentIntentId,
      providerCustomerId: event.providerCustomerId,
      status: event.status,
      paymentStatus: event.paymentStatus,
      amountMinor: event.amountMinor,
      currency: event.currency,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
  }
}
