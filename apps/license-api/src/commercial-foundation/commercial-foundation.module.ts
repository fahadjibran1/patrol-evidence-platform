import { Module } from '@nestjs/common';
import { CommercialPurchaseService } from './commercial-purchase.service';
import { PurchaseRequestValidator } from './purchase-request.validator';
import { CommercialOrderService } from './commercial-order.service';
import { CommercialIssuanceService } from './commercial-issuance.service';
import {
  COMMERCIAL_LICENCE_ISSUER,
  DisabledCommercialLicenceIssuer,
} from './commercial-issuer.port';
import { CommercialConfigService } from './commercial-config.service';
import { CommercialCheckoutService } from './commercial-checkout.service';
import { CommercialWebhookService } from './commercial-webhook.service';
import { CommercialPaymentReconciliationService } from './commercial-payment-reconciliation.service';
import { CommercialOutboxWorkerService } from './commercial-outbox-worker.service';
import { StripeCommercialPaymentProvider } from './stripe-commercial-payment.provider';
import { COMMERCIAL_PAYMENT_PROVIDER } from './commercial-payment-provider.port';
import { CommercialController } from './commercial.controller';
import { CommercialWebhookController } from './commercial-webhook.controller';

@Module({
  controllers: [CommercialController, CommercialWebhookController],
  providers: [
    PurchaseRequestValidator,
    CommercialPurchaseService,
    CommercialOrderService,
    CommercialIssuanceService,
    DisabledCommercialLicenceIssuer,
    CommercialConfigService,
    CommercialCheckoutService,
    CommercialWebhookService,
    CommercialPaymentReconciliationService,
    CommercialOutboxWorkerService,
    StripeCommercialPaymentProvider,
    {
      provide: COMMERCIAL_LICENCE_ISSUER,
      useExisting: DisabledCommercialLicenceIssuer,
    },
    {
      provide: COMMERCIAL_PAYMENT_PROVIDER,
      useExisting: StripeCommercialPaymentProvider,
    },
  ],
  exports: [
    PurchaseRequestValidator,
    CommercialPurchaseService,
    CommercialOrderService,
    CommercialIssuanceService,
    COMMERCIAL_LICENCE_ISSUER,
    CommercialConfigService,
    CommercialCheckoutService,
    CommercialWebhookService,
    CommercialPaymentReconciliationService,
    CommercialOutboxWorkerService,
    COMMERCIAL_PAYMENT_PROVIDER,
  ],
})
export class CommercialFoundationModule {}
