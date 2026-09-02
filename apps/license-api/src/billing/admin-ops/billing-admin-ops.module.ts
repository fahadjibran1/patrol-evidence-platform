import { Module } from '@nestjs/common';
import { BillingAdminOpsController } from './billing-admin-ops.controller';
import { BillingAdminOpsService } from './billing-admin-ops.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [SubscriptionsModule],
  controllers: [BillingAdminOpsController],
  providers: [BillingAdminOpsService],
})
export class BillingAdminOpsModule {}
