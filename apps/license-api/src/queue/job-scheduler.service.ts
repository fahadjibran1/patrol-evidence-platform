import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QUEUE_NAMES } from './queue.constants';
import { QueueService } from './queue.service';

/**
 * Placeholder for periodic maintenance (e.g. pruning old NotificationLog rows, re-checking
 * stuck QUEUED jobs). Currently a no-op scheduler — wire real cron logic here once a
 * maintenance job is needed; the MAINTENANCE queue already exists for that purpose.
 */
@Injectable()
export class JobScheduler implements OnModuleInit {
  private readonly logger = new Logger(JobScheduler.name);

  constructor(private readonly queueService: QueueService) {
    this.queueService.registerProcessor(QUEUE_NAMES.MAINTENANCE, async () => {
      // No-op today. Intended for future scheduled cleanup jobs.
      return { ok: true };
    });
  }

  onModuleInit(): void {
    this.logger.log(`Job scheduler ready (mode: ${this.queueService.getMode()}). No maintenance jobs scheduled yet.`);
  }
}
