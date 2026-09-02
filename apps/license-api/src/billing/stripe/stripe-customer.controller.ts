import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BillingInterval } from '@prisma/client';
import { IsEnum, IsString, MinLength } from 'class-validator';
import { CustomerJwtAuthGuard } from '@/customer-auth/guards/customer-jwt-auth.guard';
import { CustomerPermissionsGuard } from '@/customer-auth/guards/customer-permissions.guard';
import { CurrentCustomer } from '@/customer-auth/decorators/current-customer.decorator';
import { RequireCustomerPermissions } from '@/customer-auth/decorators/require-customer-permissions.decorator';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { CustomerPermission } from '@/customer-org/customer-permissions';
import { StripeCheckoutService } from './stripe-checkout.service';

class CreateCheckoutDto {
  @IsString()
  planId!: string;

  @IsEnum(BillingInterval)
  billingInterval!: BillingInterval;

  @IsString()
  @MinLength(1)
  acceptedTermsVersion!: string;
}

@ApiTags('customer-billing-stripe')
@ApiBearerAuth()
@UseGuards(CustomerJwtAuthGuard, CustomerPermissionsGuard)
@Controller('customer/billing')
export class StripeCustomerController {
  constructor(private readonly checkoutService: StripeCheckoutService) {}

  @Post('checkout')
  @RequireCustomerPermissions(CustomerPermission.PURCHASE_BILLING)
  checkout(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() dto: CreateCheckoutDto) {
    return this.checkoutService.createCheckout(customer, dto);
  }

  @Get('checkout/:sessionId/status')
  @RequireCustomerPermissions(CustomerPermission.VIEW_BILLING)
  status(@CurrentCustomer() customer: AuthenticatedCustomer, @Param('sessionId') sessionId: string) {
    return this.checkoutService.getCheckoutStatus(customer, sessionId);
  }

  @Post('portal-session')
  @RequireCustomerPermissions(CustomerPermission.VIEW_BILLING)
  portal(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.checkoutService.createPortalSession(customer);
  }
}
