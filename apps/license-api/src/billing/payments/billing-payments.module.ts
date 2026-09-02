import { Module } from '@nestjs/common';
import { BillingPaymentsController } from './billing-payments.controller';
import { BillingPaymentsService } from './billing-payments.service';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [InvoicesModule],
  controllers: [BillingPaymentsController],
  providers: [BillingPaymentsService],
  exports: [BillingPaymentsService],
})
export class BillingPaymentsModule {}
