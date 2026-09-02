import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { JobScheduler } from './job-scheduler.service';

@Module({
  providers: [QueueService, JobScheduler],
  exports: [QueueService],
})
export class QueueModule {}
