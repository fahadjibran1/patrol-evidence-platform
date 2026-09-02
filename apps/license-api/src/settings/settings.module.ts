import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { NotificationsModule } from '@/notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
