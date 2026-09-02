import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '@/customer-auth/customer-auth.module';
import { CustomerNotificationsService } from './customer-notifications.service';
import { CustomerNotificationsController } from './customer-notifications.controller';

@Module({
  imports: [CustomerAuthModule],
  controllers: [CustomerNotificationsController],
  providers: [CustomerNotificationsService],
})
export class CustomerNotificationsModule {}
