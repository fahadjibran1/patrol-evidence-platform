import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CustomerJwtAuthGuard } from '@/customer-auth/guards/customer-jwt-auth.guard';
import { CurrentCustomer } from '@/customer-auth/decorators/current-customer.decorator';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { CustomerNotificationsService } from './customer-notifications.service';
import type { NotificationCategory } from '@/customer-portal/customer-portal.util';

class ListCustomerNotificationsQueryDto {
  @IsOptional()
  @IsIn(['licence', 'general', 'system'])
  category?: NotificationCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

@ApiTags('customer-notifications')
@ApiBearerAuth()
@UseGuards(CustomerJwtAuthGuard)
@Controller('customer/notifications')
export class CustomerNotificationsController {
  constructor(private readonly notificationsService: CustomerNotificationsService) {}

  @Get()
  list(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Query() query: ListCustomerNotificationsQueryDto,
  ) {
    return this.notificationsService.list(customer, query);
  }
}
