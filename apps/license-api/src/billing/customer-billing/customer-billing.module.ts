import { Module } from '@nestjs/common';
import { CustomerBillingController } from './customer-billing.controller';
import { CustomerBillingService } from './customer-billing.service';
import { CustomerSelfServiceService } from './customer-self-service.service';
import { PlansModule } from '../plans/plans.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { BillingPaymentsModule } from '../payments/billing-payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { CustomerAuthModule } from '@/customer-auth/customer-auth.module';
import { StripeBillingModule } from '../stripe/stripe-billing.module';

@Module({
  imports: [
    CustomerAuthModule,
    PlansModule,
    SubscriptionsModule,
    InvoicesModule,
    BillingPaymentsModule,
    PricingModule,
    StripeBillingModule,
  ],
  controllers: [CustomerBillingController],
  providers: [CustomerBillingService, CustomerSelfServiceService],
  exports: [CustomerSelfServiceService],
})
export class CustomerBillingModule {}
