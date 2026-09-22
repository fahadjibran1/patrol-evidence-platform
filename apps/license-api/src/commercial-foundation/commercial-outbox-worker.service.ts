import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CommercialProviderEventStatus, OutboxEventStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { CommercialConfigService } from './commercial-config.service';
import { CommercialPaymentReconciliationService } from './commercial-payment-reconciliation.service';

@Injectable()
export class CommercialOutboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommercialOutboxWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly workerId = `commercial-${randomUUID()}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: CommercialConfigService,
    private readonly reconciliation: CommercialPaymentReconciliationService,
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
        await this.reconciliation.reconcileOutboxEvent(event.id);
        processed += 1;
      } catch (error) {
        failed += 1;
        await this.recordFailure(event.id, event.aggregateId, event.attempts, error, now);
      }
    }
    return { processed, failed };
  }

  private async claimNext(now: Date) {
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    for (let attempts = 0; attempts < 5; attempts += 1) {
      const candidate = await this.prisma.commercialOutboxEvent.findFirst({
        where: {
          eventType: 'commercial.provider_event.received',
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
        await this.prisma.commercialProviderEvent.updateMany({
          where: { id: event.aggregateId },
          data: { status: CommercialProviderEventStatus.PROCESSING },
        });
        return event;
      }
    }
    return null;
  }

  private async recordFailure(
    outboxId: string,
    providerEventId: string,
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
      await tx.commercialProviderEvent.updateMany({
        where: { id: providerEventId },
        data: {
          status: CommercialProviderEventStatus.FAILED,
          attempts: { increment: 1 },
          lastError: safeError,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private safeError(error: unknown): string {
    if (error instanceof ApiException) return `commercial_error:${error.code}`;
    if (error instanceof Error && error.name === 'PrismaClientKnownRequestError') {
      return 'commercial_database_constraint_error';
    }
    return 'commercial_provider_or_worker_error';
  }
}
