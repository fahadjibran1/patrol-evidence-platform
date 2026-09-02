import { Module } from '@nestjs/common';
import { SupportOpsController } from './support-ops.controller';
import { SupportOpsService } from './support-ops.service';
import { NotificationsModule } from '@/notifications/notifications.module';
import { CustomerAuthModule } from '@/customer-auth/customer-auth.module';
import { StripeBillingModule } from '@/billing/stripe/stripe-billing.module';

@Module({
  imports: [NotificationsModule, CustomerAuthModule, StripeBillingModule],
  controllers: [SupportOpsController],
  providers: [SupportOpsService],
  exports: [SupportOpsService],
})
export class SupportOpsModule {}
