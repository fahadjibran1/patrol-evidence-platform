import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BillingInterval } from '@prisma/client';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CustomerJwtAuthGuard } from '@/customer-auth/guards/customer-jwt-auth.guard';
import { CustomerPermissionsGuard } from '@/customer-auth/guards/customer-permissions.guard';
import { CurrentCustomer } from '@/customer-auth/decorators/current-customer.decorator';
import { RequireCustomerPermissions } from '@/customer-auth/decorators/require-customer-permissions.decorator';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { CustomerPermission } from '@/customer-org/customer-permissions';
import { CustomerBillingService } from './customer-billing.service';
import { CustomerSelfServiceService } from './customer-self-service.service';

class PreviewUpgradeDto {
  @IsString()
  planId!: string;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;
}

class ConfirmUpgradeDto extends PreviewUpgradeDto {
  @IsString()
  @MinLength(1)
  acceptedTermsVersion!: string;
}

class ScheduleDowngradeDto {
  @IsString()
  planId!: string;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;
}

class RenewDto {
  @IsString()
  @MinLength(1)
  acceptedTermsVersion!: string;
}

class CancelDto {
  @IsOptional()
  @IsBoolean()
  atPeriodEnd?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class BillingSettingsDto {
  @IsOptional()
  @IsEmail()
  billingEmail?: string;

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  invoiceRecipients?: string[];

  @IsOptional()
  @IsBoolean()
  allowFinancePurchases?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxId?: string | null;
}

@ApiTags('customer-billing')
@ApiBearerAuth()
@UseGuards(CustomerJwtAuthGuard, CustomerPermissionsGuard)
@Controller('customer/billing')
export class CustomerBillingController {
  constructor(
    private readonly customerBillingService: CustomerBillingService,
    private readonly selfService: CustomerSelfServiceService,
  ) {}

  @Get()
  @RequireCustomerPermissions(CustomerPermission.VIEW_BILLING)
  overview(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.selfService.dashboard(customer);
  }

  @Get('subscription')
  @RequireCustomerPermissions(CustomerPermission.VIEW_BILLING)
  subscription(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.customerBillingService.currentSubscription(customer);
  }

  @Get('plans')
  @RequireCustomerPermissions(CustomerPermission.VIEW_BILLING)
  plans(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.customerBillingService.listPlans(customer);
  }

  @Get('plans/compare')
  @RequireCustomerPermissions(CustomerPermission.VIEW_BILLING)
  compare(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.selfService.comparePlans(customer);
  }

  @Get('invoices')
  @RequireCustomerPermissions(CustomerPermission.VIEW_BILLING)
  invoices(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.customerBillingService.invoices(customer);
  }

  @Get('payments')
  @RequireCustomerPermissions(CustomerPermission.VIEW_BILLING)
  payments(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.customerBillingService.payments(customer);
  }

  @Get('payment-method')
  @RequireCustomerPermissions(CustomerPermission.VIEW_BILLING)
  paymentMethod(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.selfService.paymentMethod(customer);
  }

  @Post('payment-method/portal')
  @RequireCustomerPermissions(CustomerPermission.VIEW_BILLING)
  paymentPortal(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.selfService.openPaymentPortal(customer);
  }

  @Post('upgrade/preview')
  @RequireCustomerPermissions(CustomerPermission.PURCHASE_BILLING)
  previewUpgrade(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() dto: PreviewUpgradeDto) {
    return this.selfService.previewUpgrade(customer, dto);
  }

  @Post('upgrade')
  @RequireCustomerPermissions(CustomerPermission.PURCHASE_BILLING)
  upgrade(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() dto: ConfirmUpgradeDto) {
    return this.selfService.confirmUpgrade(customer, dto);
  }

  @Post('downgrade')
  @RequireCustomerPermissions(CustomerPermission.PURCHASE_BILLING)
  downgrade(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() dto: ScheduleDowngradeDto) {
    return this.selfService.scheduleDowngrade(customer, dto);
  }

  @Post('plan-change/cancel')
  @RequireCustomerPermissions(CustomerPermission.PURCHASE_BILLING)
  cancelPlanChange(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.selfService.cancelScheduledChange(customer);
  }

  @Post('renew')
  @RequireCustomerPermissions(CustomerPermission.PURCHASE_BILLING)
  renew(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() dto: RenewDto) {
    return this.selfService.renew(customer, dto);
  }

  @Post('cancel')
  @RequireCustomerPermissions(CustomerPermission.PURCHASE_BILLING)
  cancel(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() dto: CancelDto) {
    return this.selfService.cancel(customer, dto);
  }

  @Post('cancel/undo')
  @RequireCustomerPermissions(CustomerPermission.PURCHASE_BILLING)
  undoCancel(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.selfService.undoCancel(customer);
  }

  @Get('settings')
  @RequireCustomerPermissions(CustomerPermission.VIEW_BILLING)
  getSettings(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.selfService.getSettings(customer);
  }

  @Post('settings')
  @RequireCustomerPermissions(CustomerPermission.VIEW_BILLING)
  updateSettings(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() dto: BillingSettingsDto) {
    return this.selfService.updateSettings(customer, dto);
  }
}
