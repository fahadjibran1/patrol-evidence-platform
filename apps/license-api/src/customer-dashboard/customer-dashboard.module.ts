import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '@/customer-auth/customer-auth.module';
import { CustomerDashboardService } from './customer-dashboard.service';
import { CustomerDashboardController } from './customer-dashboard.controller';

@Module({
  imports: [CustomerAuthModule],
  controllers: [CustomerDashboardController],
  providers: [CustomerDashboardService],
})
export class CustomerDashboardModule {}
