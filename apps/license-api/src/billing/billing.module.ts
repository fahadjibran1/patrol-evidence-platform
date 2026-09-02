import { Module } from '@nestjs/common';
import { SharedBillingModule } from './shared/shared-billing.module';
import { PricingModule } from './pricing/pricing.module';
import { PlansModule } from './plans/plans.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { InvoicesModule } from './invoices/invoices.module';
import { BillingPaymentsModule } from './payments/billing-payments.module';
import { CustomerBillingModule } from './customer-billing/customer-billing.module';
import { BillingMetricsModule } from './billing-metrics.module';
import { StripeBillingModule } from './stripe/stripe-billing.module';
import { BillingAdminOpsModule } from './admin-ops/billing-admin-ops.module';

/**
 * Billing bounded context root. MANUAL + STRIPE (Phase 5A/5B).
 * Commercial lifecycle: Subscription → Billing → Domain Event → Licence Generator.
 * Stripe is a payment provider adapter — never the source of truth.
 */
@Module({
  imports: [
    SharedBillingModule,
    PricingModule,
    PlansModule,
    InvoicesModule,
    SubscriptionsModule,
    BillingPaymentsModule,
    CustomerBillingModule,
    BillingMetricsModule,
    StripeBillingModule,
    BillingAdminOpsModule,
  ],
  exports: [
    SharedBillingModule,
    PricingModule,
    PlansModule,
    InvoicesModule,
    SubscriptionsModule,
    BillingPaymentsModule,
    BillingMetricsModule,
    StripeBillingModule,
    BillingAdminOpsModule,
  ],
})
export class BillingModule {}
