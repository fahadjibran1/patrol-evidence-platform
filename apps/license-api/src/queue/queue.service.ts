import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_RETRY_DELAYS_MS,
  QUEUE_NAMES,
  type QueueName,
} from './queue.constants';
import type { EmailJobPayload, EmailJobResult, QueueMode, QueueProcessor, QueueStats } from './queue.types';

const ALL_QUEUE_NAMES: QueueName[] = Object.values(QUEUE_NAMES);

/**
 * Thin queue abstraction with two modes:
 *  - "redis": REDIS_URL is set — real BullMQ Queues + Workers are created against it.
 *  - "inline": REDIS_URL is unset (default, including all test environments) — jobs run
 *    synchronously in-process via whatever processor was registered for that queue. This
 *    keeps Redis fully optional while preserving a single code path for callers.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly redisUrl?: string;
  private redisConnection: Redis | null = null;
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers = new Map<QueueName, Worker>();
  private readonly processors = new Map<QueueName, QueueProcessor>();

  constructor(@Optional() private readonly configService?: ConfigService) {
    this.redisUrl =
      this.configService?.get<string>('REDIS_URL')?.trim() || process.env.REDIS_URL?.trim() || undefined;
  }

  isRedisEnabled(): boolean {
    return Boolean(this.redisUrl) && this.redisConnection !== null;
  }

  getMode(): QueueMode {
    return this.isRedisEnabled() ? 'redis' : 'inline';
  }

  async onModuleInit(): Promise<void> {
    if (!this.redisUrl) {
      this.logger.log('REDIS_URL not set — queues running in inline (synchronous, in-process) mode.');
      return;
    }

    try {
      this.redisConnection = new IORedis(this.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
      for (const name of ALL_QUEUE_NAMES) {
        this.queues.set(name, new Queue(name, { connection: this.redisConnection }));
      }
      for (const [name, processor] of this.processors.entries()) {
        this.attachWorker(name, processor);
      }
      this.logger.log('Connected to Redis — queues running in BullMQ mode.');
    } catch (error) {
      this.logger.error(
        `Failed to initialise Redis-backed queues; falling back to inline mode: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.redisConnection = null;
      this.queues.clear();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.workers.values()].map((worker) => worker.close().catch(() => undefined)));
    await Promise.all([...this.queues.values()].map((queue) => queue.close().catch(() => undefined)));
    if (this.redisConnection) {
      await this.redisConnection.quit().catch(() => undefined);
    }
  }

  /**
   * Registers the function that performs work for a given queue. Safe to call before or
   * after `onModuleInit` — if Redis is enabled and the queue already exists, a Worker is
   * attached immediately; otherwise the processor is simply used for inline dispatch.
   */
  registerProcessor<TPayload, TResult>(name: QueueName, processor: QueueProcessor<TPayload, TResult>): void {
    this.processors.set(name, processor as QueueProcessor);
    if (this.isRedisEnabled() && this.queues.has(name) && !this.workers.has(name)) {
      this.attachWorker(name, processor as QueueProcessor);
    }
  }

  async enqueueEmail(payload: EmailJobPayload): Promise<EmailJobResult> {
    const attempt = payload.attempt ?? 1;

    if (this.isRedisEnabled()) {
      const queue = this.queues.get(QUEUE_NAMES.EMAIL);
      if (queue) {
        await queue.add(
          'send-email',
          { ...payload, attempt },
          {
            attempts: EMAIL_MAX_ATTEMPTS,
            backoff: { type: 'custom' },
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 86_400 },
          },
        );
        return { success: true, logId: payload.notificationLogId, status: 'QUEUED', queued: true };
      }
    }

    // Inline mode: run the registered processor synchronously.
    const processor = this.processors.get(QUEUE_NAMES.EMAIL) as
      | QueueProcessor<EmailJobPayload, EmailJobResult>
      | undefined;
    if (!processor) {
      this.logger.warn('enqueueEmail was called before an EMAIL processor was registered.');
      return {
        success: false,
        logId: payload.notificationLogId,
        status: 'FAILED',
        errorMessage: 'No email processor registered',
      };
    }
    return processor(payload);
  }

  async enqueueStripeWebhook(payload: { webhookEventId: string }): Promise<{ queued: boolean }> {
    if (this.isRedisEnabled()) {
      const queue = this.queues.get(QUEUE_NAMES.STRIPE_WEBHOOKS);
      if (queue) {
        await queue.add('process-stripe-webhook', payload, {
          attempts: 8,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 86_400, count: 2000 },
          removeOnFail: { age: 604_800 },
          jobId: `stripe-webhook-${payload.webhookEventId}`,
        });
        return { queued: true };
      }
    }

    const processor = this.processors.get(QUEUE_NAMES.STRIPE_WEBHOOKS);
    if (!processor) {
      this.logger.warn('enqueueStripeWebhook called before processor registration');
      return { queued: false };
    }
    await processor(payload);
    return { queued: false };
  }

  async getQueueStats(): Promise<QueueStats[]> {
    const mode = this.getMode();
    return Promise.all(
      ALL_QUEUE_NAMES.map(async (name) => {
        const queue = this.queues.get(name);
        if (!queue) {
          return { name, waiting: 0, active: 0, failed: 0, delayed: 0, mode };
        }
        const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
          mode,
        };
      }),
    );
  }

  private attachWorker(name: QueueName, processor: QueueProcessor): void {
    if (!this.redisConnection) {
      return;
    }
    const worker = new Worker(
      name,
      async (job: Job) => processor(job.data),
      {
        connection: this.redisConnection,
        settings: {
          backoffStrategy: (attemptsMade: number) =>
            EMAIL_RETRY_DELAYS_MS[Math.min(attemptsMade - 1, EMAIL_RETRY_DELAYS_MS.length - 1)],
        },
      },
    );
    worker.on('completed', (job, result) => {
      this.logger.log(
        JSON.stringify({
          jobId: job.id,
          queue: name,
          attempts: job.attemptsMade,
          result: typeof result === 'object' ? result : { value: result },
          status: 'completed',
        }),
      );
    });
    worker.on('failed', (job, err) => {
      this.logger.warn(
        JSON.stringify({
          jobId: job?.id ?? 'unknown',
          queue: name,
          attempts: job?.attemptsMade ?? 0,
          result: { error: err.message },
          status: 'failed',
        }),
      );
    });
    this.workers.set(name, worker);
  }
}
