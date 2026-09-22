import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '@/auth/auth.module';
import { CommercialPurchaseService } from './commercial-purchase.service';
import { PurchaseRequestValidator } from './purchase-request.validator';
import { CommercialOrderService } from './commercial-order.service';
import { CommercialIssuanceService } from './commercial-issuance.service';
import {
  COMMERCIAL_LICENCE_ISSUER,
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
import { CommercialOperatorController } from './commercial-operator.controller';
import { CommercialStepUpService } from './commercial-step-up.service';
import { CommercialApprovalPreconditionsService } from './commercial-approval-preconditions.service';
import { CommercialOperatorPermissionGuard } from './guards/commercial-operator-permission.guard';
import { CurrentFormatCommercialLicenceIssuer } from './current-format-commercial-licence.issuer';
import { TestFileEd25519SigningProvider } from './test-file-ed25519-signing.provider';
import { PrivateTestArtifactStore } from './private-test-artifact.store';

@Module({
  imports: [AuthModule],
  controllers: [CommercialController, CommercialWebhookController, CommercialOperatorController],
  providers: [
    PurchaseRequestValidator,
    CommercialPurchaseService,
    CommercialOrderService,
    CommercialIssuanceService,
    CommercialStepUpService,
    CommercialApprovalPreconditionsService,
    CommercialOperatorPermissionGuard,
    CommercialConfigService,
    CommercialCheckoutService,
    CommercialWebhookService,
    CommercialPaymentReconciliationService,
    CommercialOutboxWorkerService,
    StripeCommercialPaymentProvider,
    {
      provide: COMMERCIAL_LICENCE_ISSUER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new CurrentFormatCommercialLicenceIssuer(
        new TestFileEd25519SigningProvider(config),
        new PrivateTestArtifactStore(config),
      ),
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
    CommercialStepUpService,
    CommercialApprovalPreconditionsService,
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
