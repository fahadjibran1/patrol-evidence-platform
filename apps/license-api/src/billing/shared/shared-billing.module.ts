import { Global, Module } from '@nestjs/common';
import { FeatureService } from './feature.service';
import { PlanFeatureResolver } from './plan-feature-resolver';

@Global()
@Module({
  providers: [FeatureService, PlanFeatureResolver],
  exports: [FeatureService, PlanFeatureResolver],
})
export class SharedBillingModule {}
