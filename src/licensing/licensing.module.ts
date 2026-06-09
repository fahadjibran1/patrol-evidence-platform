import { Global, Module } from '@nestjs/common';
import { LicensingService } from './licensing.service';

@Global()
@Module({
  providers: [LicensingService],
  exports: [LicensingService],
})
export class LicensingModule {}

