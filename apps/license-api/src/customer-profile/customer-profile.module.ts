import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '@/customer-auth/customer-auth.module';
import { CustomerOrgModule } from '@/customer-org/customer-org.module';
import { CustomerProfileController } from './customer-profile.controller';

@Module({
  imports: [CustomerAuthModule, CustomerOrgModule],
  controllers: [CustomerProfileController],
})
export class CustomerProfileModule {}
