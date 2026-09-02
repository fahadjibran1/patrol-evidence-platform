import { Global, Module } from '@nestjs/common';
import { InstallationIdentityService } from './installation-identity.service';
import { LicenceBootstrapService } from './licence-bootstrap.service';
import { LicenceEvaluationService } from './licence-evaluation.service';
import { LicenceFeatureGuard } from './licence-feature.guard';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { LicensingService } from './licensing.service';
import { LocalTrialService } from './local-trial.service';

@Global()
@Module({
  controllers: [LicenseController],
  providers: [
    InstallationIdentityService,
    LocalTrialService,
    LicenceEvaluationService,
    LicenceBootstrapService,
    LicenceFeatureGuard,
    LicenseService,
    LicensingService,
  ],
  exports: [
    InstallationIdentityService,
    LocalTrialService,
    LicenceEvaluationService,
    LicenceBootstrapService,
    LicenceFeatureGuard,
    LicenseService,
    LicensingService,
  ],
})
export class LicensingModule {}
