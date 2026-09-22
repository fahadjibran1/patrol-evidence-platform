import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { CommercialProviderEventStatus, OutboxEventStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { CommercialConfigService } from './commercial-config.service';
import { CommercialPaymentReconciliationService } from './commercial-payment-reconciliation.service';
import { CommercialIssuanceService } from './commercial-issuance.service';
import { CommercialDeliveryService } from './commercial-delivery.service';

@Injectable()
export class CommercialOutboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommercialOutboxWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly workerId = `commercial-${randomUUID()}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: CommercialConfigService,
    private readonly reconciliation: CommercialPaymentReconciliationService,
    @Optional() private readonly issuance?: CommercialIssuanceService,
    @Optional() private readonly delivery?: CommercialDeliveryService,
  ) {}

  onModuleInit(): void {
    if (!this.config.isOutboxWorkerEnabled()) return;
    this.timer = setInterval(() => {
      void this.processPending(10).catch((error) => {
        this.logger.error(`Commercial outbox cycle failed: ${this.safeError(error)}`);
      });
    }, 5_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async processPending(limit = 10, now = new Date()): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;
    for (let index = 0; index < limit; index += 1) {
      const event = await this.claimNext(now);
      if (!event) break;
      try {
        await this.processEvent(event);
        processed += 1;
      } catch (error) {
        failed += 1;
        await this.recordFailure(event.id, event.aggregateId, event.eventType, event.attempts, error, now);
      }
    }
    return { processed, failed };
  }

  private async claimNext(now: Date) {
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    for (let attempts = 0; attempts < 5; attempts += 1) {
      const candidate = await this.prisma.commercialOutboxEvent.findFirst({
        where: {
          eventType: { in: ['commercial.provider_event.received', 'commercial.issuance.requested', 'commercial.delivery.requested', 'commercial.delivery.provider_event.received'] },
          availableAt: { lte: now },
          OR: [
            { status: { in: [OutboxEventStatus.PENDING, OutboxEventStatus.FAILED] } },
            { status: OutboxEventStatus.PROCESSING, lockedAt: { lte: staleBefore } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!candidate) return null;
      const claimed = await this.prisma.commercialOutboxEvent.updateMany({
        where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts },
        data: {
          status: OutboxEventStatus.PROCESSING,
          attempts: { increment: 1 },
          lockedAt: now,
          lockedBy: this.workerId,
          lastError: null,
        },
      });
      if (claimed.count === 1) {
        const event = await this.prisma.commercialOutboxEvent.findUniqueOrThrow({ where: { id: candidate.id } });
        if (event.eventType === 'commercial.provider_event.received') {
          await this.prisma.commercialProviderEvent.updateMany({
            where: { id: event.aggregateId },
            data: { status: CommercialProviderEventStatus.PROCESSING },
          });
        }
        return event;
      }
    }
    return null;
  }

  private async recordFailure(
    outboxId: string,
    providerEventId: string,
    eventType: string,
    attempts: number,
    error: unknown,
    now: Date,
  ): Promise<void> {
    const delayMs = Math.min(60 * 60_000, 5_000 * (2 ** Math.min(attempts, 8)));
    const safeError = this.safeError(error);
    await this.prisma.$transaction(async (tx) => {
      await tx.commercialOutboxEvent.update({
        where: { id: outboxId },
        data: {
          status: OutboxEventStatus.FAILED,
          availableAt: new Date(now.getTime() + delayMs),
          lockedAt: null,
          lockedBy: null,
          lastError: safeError,
        },
      });
      if (eventType === 'commercial.provider_event.received') {
        await tx.commercialProviderEvent.updateMany({
          where: { id: providerEventId },
          data: { status: CommercialProviderEventStatus.FAILED, attempts: { increment: 1 }, lastError: safeError },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async processEvent(event: { id: string; aggregateId: string; eventType: string; correlationId: string }): Promise<void> {
    if (event.eventType === 'commercial.provider_event.received') {
      await this.reconciliation.reconcileOutboxEvent(event.id);
      return;
    }
    if (event.eventType === 'commercial.issuance.requested') {
      if (!this.issuance) throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUER_DISABLED, 'Commercial issuance worker is disabled.', 503);
      await this.issuance.processApprovedIssuance(event.aggregateId, event.correlationId);
      await this.prisma.commercialOutboxEvent.update({
        where: { id: event.id },
        data: { status: OutboxEventStatus.PUBLISHED, publishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
      });
      return;
    }
    if (event.eventType === 'commercial.delivery.requested') {
      if (!this.delivery) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_PROVIDER_DISABLED, 'Commercial delivery worker is disabled.', 503);
      await this.delivery.processDeliveryOutbox(event.id);
      return;
    }
    if (event.eventType === 'commercial.delivery.provider_event.received') {
      if (!this.delivery) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_PROVIDER_DISABLED, 'Commercial delivery worker is disabled.', 503);
      await this.delivery.processProviderEventOutbox(event.id);
      return;
    }
    throw new ApiException(ERROR_CODES.COMMERCIAL_OUTBOX_INVALID, 'Commercial outbox event type is not supported.', 409);
  }

  private safeError(error: unknown): string {
    if (error instanceof ApiException) return `commercial_error:${error.code}`;
    if (error instanceof Error && error.name === 'PrismaClientKnownRequestError') {
      return 'commercial_database_constraint_error';
    }
    return 'commercial_provider_or_worker_error';
  }
}
