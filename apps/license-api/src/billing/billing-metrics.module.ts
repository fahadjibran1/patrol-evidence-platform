import { Module } from '@nestjs/common';
import { BillingMetricsService } from './billing-metrics.service';

@Module({
  providers: [BillingMetricsService],
  exports: [BillingMetricsService],
})
export class BillingMetricsModule {}
