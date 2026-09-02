import { Injectable } from '@nestjs/common';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import type { PaymentProviderPort } from '../providers/payment-provider.port';

/** Manual provider — checkout/webhooks unsupported; payments via admin recordManual. */
@Injectable()
export class ManualPaymentProvider implements PaymentProviderPort {
  readonly name = 'MANUAL';

  isEnabled(): boolean {
    return true;
  }

  getMode(): 'TEST' | 'LIVE' | 'DISABLED' {
    return 'DISABLED';
  }

  private unsupported(): never {
    throw new ApiException(
      ERROR_CODES.BILLING_PROVIDER_UNSUPPORTED,
      'Manual provider does not support this operation',
      400,
    );
  }

  createCheckoutSession() {
    return this.unsupported();
  }
  createPaymentCheckoutSession() {
    return this.unsupported();
  }
  retrieveCheckoutSession() {
    return this.unsupported();
  }
  retrieveCustomer() {
    return this.unsupported();
  }
  createCustomer() {
    return this.unsupported();
  }
  retrieveSubscription() {
    return this.unsupported();
  }
  updateSubscriptionPrice() {
    return this.unsupported();
  }
  setSubscriptionCancelAtPeriodEnd() {
    return this.unsupported();
  }
  cancelSubscriptionNow() {
    return this.unsupported();
  }
  retrieveDefaultPaymentMethod() {
    return this.unsupported();
  }
  retrieveInvoice() {
    return this.unsupported();
  }
  retrievePrice() {
    return this.unsupported();
  }
  createBillingPortalSession() {
    return this.unsupported();
  }
  verifyWebhookSignature() {
    return this.unsupported();
  }
  mapProviderSubscriptionStatus(status: string): string {
    return status;
  }
}
