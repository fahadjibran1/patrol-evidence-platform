import { Module } from '@nestjs/common';
import { LicencesController } from './licences.controller';
import { LicencesService } from './licences.service';
import { LicenceBillingSyncHandler } from './licence-billing-sync.handler';
import { NotificationsModule } from '@/notifications/notifications.module';
import { SharedBillingModule } from '@/billing/shared/shared-billing.module';

@Module({
  imports: [NotificationsModule, SharedBillingModule],
  controllers: [LicencesController],
  providers: [LicencesService, LicenceBillingSyncHandler],
  exports: [LicencesService, LicenceBillingSyncHandler],
})
export class LicencesModule {}
