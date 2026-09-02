import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '@/customer-auth/customer-auth.module';
import { CustomerDownloadsModule } from '@/customer-downloads/customer-downloads.module';
import { CustomerLicencesService } from './customer-licences.service';
import { CustomerLicencesController } from './customer-licences.controller';

@Module({
  imports: [CustomerAuthModule, CustomerDownloadsModule],
  controllers: [CustomerLicencesController],
  providers: [CustomerLicencesService],
  exports: [CustomerLicencesService],
})
export class CustomerLicencesModule {}
