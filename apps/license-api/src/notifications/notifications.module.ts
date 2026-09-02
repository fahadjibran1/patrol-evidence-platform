import { Module } from '@nestjs/common';
import { EmailProvider } from './providers/email.provider';
import { NotificationService } from './notifications.service';
import { NOTIFICATION_PROVIDERS } from './interfaces/notification-provider.interface';
import { QueueModule } from '@/queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [
    EmailProvider,
    {
      provide: NOTIFICATION_PROVIDERS,
      useFactory: (emailProvider: EmailProvider) => [emailProvider],
      inject: [EmailProvider],
    },
    NotificationService,
  ],
  exports: [NotificationService, EmailProvider],
})
export class NotificationsModule {}
