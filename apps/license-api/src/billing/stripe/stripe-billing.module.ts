import { Module } from '@nestjs/common';
import { StripeConfigService } from './stripe-config.service';
import { StripePaymentProvider } from './stripe-payment.provider';
import { ManualPaymentProvider } from '../providers/manual-payment.provider';
import { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import { StripeCheckoutService } from './stripe-checkout.service';
import { StripeWebhookService } from './stripe-webhook.service';
import { StripeWebhookProcessor } from './stripe-webhook.processor';
import { StripePriceMappingService } from './stripe-price-mapping.service';
import { StripeReconciliationService } from './stripe-reconciliation.service';
import { StripeNotificationsService } from './stripe-notifications.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeAdminController } from './stripe-admin.controller';
import { StripeCustomerController } from './stripe-customer.controller';
import { InvoicesModule } from '../invoices/invoices.module';
import { BillingPaymentsModule } from '../payments/billing-payments.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CustomerAuthModule } from '@/customer-auth/customer-auth.module';
import { NotificationsModule } from '@/notifications/notifications.module';
import { QueueModule } from '@/queue/queue.module';

@Module({
  imports: [
    InvoicesModule,
    BillingPaymentsModule,
    SubscriptionsModule,
    CustomerAuthModule,
    NotificationsModule,
    QueueModule,
  ],
  controllers: [StripeWebhookController, StripeAdminController, StripeCustomerController],
  providers: [
    StripeConfigService,
    StripePaymentProvider,
    ManualPaymentProvider,
    PaymentProviderRegistry,
    StripeCheckoutService,
    StripeWebhookProcessor,
    StripeWebhookService,
    StripePriceMappingService,
    StripeReconciliationService,
    StripeNotificationsService,
  ],
  exports: [
    StripeConfigService,
    PaymentProviderRegistry,
    StripePaymentProvider,
    StripeReconciliationService,
    StripeNotificationsService,
    StripeWebhookService,
  ],
})
export class StripeBillingModule {}
