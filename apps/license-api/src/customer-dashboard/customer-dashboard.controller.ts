import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomerJwtAuthGuard } from '@/customer-auth/guards/customer-jwt-auth.guard';
import { CurrentCustomer } from '@/customer-auth/decorators/current-customer.decorator';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { CustomerDashboardService } from './customer-dashboard.service';

@ApiTags('customer-dashboard')
@ApiBearerAuth()
@UseGuards(CustomerJwtAuthGuard)
@Controller('customer/dashboard')
export class CustomerDashboardController {
  constructor(private readonly dashboardService: CustomerDashboardService) {}

  @Get()
  getSummary(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.dashboardService.getSummary(customer);
  }
}
