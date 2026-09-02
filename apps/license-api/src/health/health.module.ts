import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { QueueModule } from '@/queue/queue.module';
import { NotificationsModule } from '@/notifications/notifications.module';

@Module({
  imports: [QueueModule, NotificationsModule],
  controllers: [HealthController],
})
export class HealthModule {}
