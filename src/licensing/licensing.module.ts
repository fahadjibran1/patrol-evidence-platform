import { Global, Module } from '@nestjs/common';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { LicensingService } from './licensing.service';

@Global()
@Module({
  controllers: [LicenseController],
  providers: [LicenseService, LicensingService],
  exports: [LicenseService, LicensingService],
})
export class LicensingModule {}
