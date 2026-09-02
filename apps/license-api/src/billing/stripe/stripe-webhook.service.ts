import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { StripeWebhookProcessingStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { QueueService } from '@/queue/queue.service';
import { QUEUE_NAMES } from '@/queue/queue.constants';
import { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import { StripeConfigService } from './stripe-config.service';
import { StripeWebhookProcessor } from './stripe-webhook.processor';
import { MetricsService } from '@/metrics/metrics.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

@Injectable()
export class StripeWebhookService implements OnModuleInit {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly queueService: QueueService,
    private readonly providers: PaymentProviderRegistry,
    private readonly stripeConfig: StripeConfigService,
    private readonly processor: StripeWebhookProcessor,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit(): void {
    this.queueService.registerProcessor(QUEUE_NAMES.STRIPE_WEBHOOKS, async (payload: { webhookEventId: string }) => {
      await this.processor.processStoredEvent(payload.webhookEventId);
      return { ok: true };
    });
  }

  /**
   * Verify signature, persist idempotent event, enqueue processing, return quickly.
   */
  async ingest(rawBody: Buffer, signature: string | undefined) {
    if (!signature) {
      throw new ApiException(ERROR_CODES.STRIPE_WEBHOOK_INVALID, 'Missing Stripe-Signature', 400);
    }
    if (!this.stripeConfig.getConfig().enabled) {
      throw new ApiException(ERROR_CODES.STRIPE_DISABLED, 'Stripe disabled', 503);
    }

    const verified = this.providers.getStripe().verifyWebhookSignature(rawBody, signature);
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    const existing = await this.prisma.stripeWebhookEvent.findUnique({
      where: { stripeEventId: verified.id },
    });
    if (existing) {
      this.metrics?.increment('stripeWebhookReceived');
      return { received: true, duplicate: true, eventId: existing.id };
    }

    const object = verified.dataObject;
    const metadata = {
      objectId: typeof object.id === 'string' ? object.id : null,
      objectType: typeof object.object === 'string' ? object.object : null,
      customerId: typeof object.customer === 'string' ? object.customer : null,
      subscriptionId: typeof object.subscription === 'string' ? object.subscription : null,
    };

    const stored = await this.prisma.stripeWebhookEvent.create({
      data: {
        stripeEventId: verified.id,
        type: verified.type,
        apiVersion: verified.apiVersion,
        livemode: verified.livemode,
        processingStatus: StripeWebhookProcessingStatus.RECEIVED,
        payloadHash,
        metadata,
      },
    });

    await this.auditService.record({
      action: 'stripe.webhook.received',
      entityType: 'StripeWebhookEvent',
      entityId: stored.id,
      metadata: {
        stripeEventId: verified.id,
        type: verified.type,
        livemode: verified.livemode,
      },
    });

    this.metrics?.increment('stripeWebhookReceived');
    await this.queueService.enqueueStripeWebhook({ webhookEventId: stored.id });

    return { received: true, duplicate: false, eventId: stored.id };
  }

  async reprocess(eventId: string, adminId: string) {
    const event = await this.prisma.stripeWebhookEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new ApiException(ERROR_CODES.STRIPE_WEBHOOK_INVALID, 'Webhook event not found', 404);
    }
    await this.prisma.stripeWebhookEvent.update({
      where: { id: eventId },
      data: {
        processingStatus: StripeWebhookProcessingStatus.RECEIVED,
        lastError: null,
      },
    });
    await this.auditService.record({
      actorAdminId: adminId,
      action: 'stripe.webhook.reprocessed',
      entityType: 'StripeWebhookEvent',
      entityId: eventId,
      metadata: { stripeEventId: event.stripeEventId, type: event.type },
    });
    await this.queueService.enqueueStripeWebhook({ webhookEventId: eventId });
    return { queued: true };
  }
}
