import { ConfigService } from '@nestjs/config';
import { CommercialConfigService } from './commercial-config.service';

describe('CommercialConfigService', () => {
  it('owns the exact annual product and price policy server-side', () => {
    const service = new CommercialConfigService(new ConfigService({}));
    expect(service.getPolicy()).toEqual(expect.objectContaining({
      product: 'Patrol Evidence Platform',
      displayName: 'PatrolSafe Annual Licence',
      plan: 'annual',
      amountMinor: 29900,
      currency: 'GBP',
      maxDevices: 1,
      taxPolicy: 'NOT_YET_PRODUCTION_AUTHORIZED',
      automaticTaxEnabled: false,
      invoiceCreationEnabled: false,
    }));
  });

  it('accepts only explicitly enabled Stripe test credentials and approved S4 redirects', () => {
    const enabled = new CommercialConfigService(new ConfigService({
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'sk_test_phase2_not_a_real_key',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_phase2_not_a_real_secret',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase2_test',
      COMMERCIAL_STRIPE_PRICE_ID: 'price_phase2_test',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
      COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
    }));
    expect(enabled.assertStripeTestReady().enabled).toBe(true);

    const restricted = new CommercialConfigService(new ConfigService({
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'rk_test_restricted_not_a_real_key',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_phase2_not_a_real_secret',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase2_test',
      COMMERCIAL_STRIPE_PRICE_ID: 'price_phase2_test',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
      COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
    }));
    expect(restricted.assertStripeTestReady().secretKey).toBe('rk_test_restricted_not_a_real_key');

    const unbound = new CommercialConfigService(new ConfigService({
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'sk_test_phase2_not_a_real_key',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_phase2_not_a_real_secret',
    }));
    expect(() => unbound.assertStripeTestReady()).toThrow('Product/Price binding');

    const live = new CommercialConfigService(new ConfigService({
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'sk_live_forbidden',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_test',
    }));
    expect(() => live.assertStripeTestReady()).toThrow('not test mode');
  });
});
