import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole, BillingInterval } from '@prisma/client';
import { IsEnum, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentAdmin } from '@/common/decorators/current-admin.decorator';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { StripePriceMappingService } from './stripe-price-mapping.service';
import { StripeReconciliationService } from './stripe-reconciliation.service';
import { StripeWebhookService } from './stripe-webhook.service';
import { StripeConfigService } from './stripe-config.service';
import { PaymentProviderRegistry } from '../providers/payment-provider.registry';

class UpsertPriceMappingDto {
  @IsString()
  planId!: string;

  @IsEnum(BillingInterval)
  billingInterval!: BillingInterval;

  @IsString()
  @MinLength(3)
  stripeProductId!: string;

  @IsString()
  @MinLength(3)
  stripePriceId!: string;
}

@ApiTags('admin-stripe')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/stripe')
export class StripeAdminController {
  constructor(
    private readonly priceMappings: StripePriceMappingService,
    private readonly reconciliation: StripeReconciliationService,
    private readonly webhooks: StripeWebhookService,
    private readonly stripeConfig: StripeConfigService,
    private readonly providers: PaymentProviderRegistry,
  ) {}

  @Get('overview')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.SUPPORT)
  overview() {
    return this.reconciliation.overview();
  }

  @Get('status')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.SUPPORT)
  status() {
    return {
      ...this.stripeConfig.getSafeStatus(),
      providers: this.providers.list(),
    };
  }

  @Get('price-mappings')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.SUPPORT)
  listMappings() {
    return this.priceMappings.list();
  }

  @Post('price-mappings')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  upsertMapping(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: UpsertPriceMappingDto) {
    return this.priceMappings.upsert(admin, dto);
  }

  @Post('price-mappings/:id/validate')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  validateMapping(@Param('id') id: string) {
    return this.priceMappings.validate(id);
  }

  @Post('price-mappings/:id/disable')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  disableMapping(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string) {
    return this.priceMappings.disable(admin, id);
  }

  @Get('webhooks')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.SUPPORT)
  listWebhooks() {
    return this.reconciliation.listWebhooks();
  }

  @Get('webhooks/failed')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.SUPPORT)
  failedWebhooks() {
    return this.reconciliation.listWebhooks('FAILED');
  }

  @Get('webhooks/dead-letter')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.SUPPORT)
  deadLetter() {
    return this.reconciliation.listWebhooks('DEAD_LETTER');
  }

  @Post('webhooks/:eventId/reprocess')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  reprocess(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('eventId') eventId: string) {
    return this.webhooks.reprocess(eventId, admin.sub);
  }

  @Get('checkout-sessions')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.SUPPORT)
  checkoutSessions() {
    return this.reconciliation.listCheckoutSessions();
  }

  @Get('alerts')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.SUPPORT)
  alerts() {
    return this.reconciliation.listAlerts();
  }

  @Post('reconcile/customer/:organisationId')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  reconcileCustomer(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('organisationId') organisationId: string,
  ) {
    return this.reconciliation.reconcileOrganisation(admin, organisationId);
  }

  @Post('reconcile/subscription/:subscriptionId')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  reconcileSubscription(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.reconciliation.reconcileSubscription(admin, subscriptionId);
  }

  @Post('reconcile/invoice/:invoiceId')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  reconcileInvoice(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('invoiceId') invoiceId: string) {
    return this.reconciliation.reconcileInvoice(admin, invoiceId);
  }
}
