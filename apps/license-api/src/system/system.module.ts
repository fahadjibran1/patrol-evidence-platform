import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';
import { QueueModule } from '@/queue/queue.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { DashboardModule } from '@/dashboard/dashboard.module';

@Module({
  imports: [QueueModule, NotificationsModule, DashboardModule],
  controllers: [SystemController, VersionController],
  providers: [VersionService],
  exports: [VersionService],
})
export class SystemModule {}
