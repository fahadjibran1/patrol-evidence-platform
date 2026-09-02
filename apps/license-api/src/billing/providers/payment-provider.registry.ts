import { Injectable } from '@nestjs/common';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import type { PaymentProviderPort } from './payment-provider.port';
import { ManualPaymentProvider } from './manual-payment.provider';
import { StripePaymentProvider } from '../stripe/stripe-payment.provider';

@Injectable()
export class PaymentProviderRegistry {
  constructor(
    private readonly manual: ManualPaymentProvider,
    private readonly stripe: StripePaymentProvider,
  ) {}

  get(name: 'MANUAL' | 'STRIPE'): PaymentProviderPort {
    if (name === 'STRIPE') {
      if (!this.stripe.isEnabled()) {
        throw new ApiException(ERROR_CODES.STRIPE_DISABLED, 'Stripe is not enabled', 503);
      }
      return this.stripe;
    }
    return this.manual;
  }

  getStripe(): StripePaymentProvider {
    return this.stripe;
  }

  list() {
    return [
      { name: 'MANUAL', enabled: true, mode: this.manual.getMode() },
      { name: 'STRIPE', enabled: this.stripe.isEnabled(), mode: this.stripe.getMode() },
    ];
  }
}
