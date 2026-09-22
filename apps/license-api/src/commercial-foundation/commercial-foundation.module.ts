import { Module } from '@nestjs/common';
import { CommercialPurchaseService } from './commercial-purchase.service';
import { PurchaseRequestValidator } from './purchase-request.validator';
import { CommercialOrderService } from './commercial-order.service';
import { CommercialIssuanceService } from './commercial-issuance.service';
import {
  COMMERCIAL_LICENCE_ISSUER,
  DisabledCommercialLicenceIssuer,
} from './commercial-issuer.port';

@Module({
  providers: [
    PurchaseRequestValidator,
    CommercialPurchaseService,
    CommercialOrderService,
    CommercialIssuanceService,
    DisabledCommercialLicenceIssuer,
    {
      provide: COMMERCIAL_LICENCE_ISSUER,
      useExisting: DisabledCommercialLicenceIssuer,
    },
  ],
  exports: [
    PurchaseRequestValidator,
    CommercialPurchaseService,
    CommercialOrderService,
    CommercialIssuanceService,
    COMMERCIAL_LICENCE_ISSUER,
  ],
})
export class CommercialFoundationModule {}
