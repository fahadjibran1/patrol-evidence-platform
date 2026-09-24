import { ConfigService } from '@nestjs/config';
import { CommercialConfigService } from './commercial-config.service';

describe('CommercialConfigService', () => {
  const stripeConfig = (overrides: Record<string, string | undefined> = {}) => ({
    COMMERCIAL_STRIPE_ENABLED: 'true',
    COMMERCIAL_STRIPE_SECRET_KEY: 'sk_test_phase2_not_a_real_key',
    COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_phase2_not_a_real_secret',
    COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase2_test',
    COMMERCIAL_STRIPE_PRICE_ID: 'price_phase2_test',
    COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
    COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
    COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
    COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
    ...overrides,
  });

  const configuredService = (overrides: Record<string, string | undefined> = {}) => {
    const values = stripeConfig(overrides);
    const config = {
      get: <T>(key: string): T | undefined => values[key as keyof typeof values] as T | undefined,
    } as ConfigService;
    return new CommercialConfigService(config);
  };

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
    const enabled = configuredService();
    expect(enabled.assertStripeTestReady().enabled).toBe(true);

    const restricted = configuredService({
      COMMERCIAL_STRIPE_SECRET_KEY: 'rk_test_restricted_not_a_real_key',
    });
    expect(restricted.assertStripeTestReady().secretKey).toBe('rk_test_restricted_not_a_real_key');

    const unbound = configuredService({
      COMMERCIAL_STRIPE_PRODUCT_ID: undefined,
      COMMERCIAL_STRIPE_PRICE_ID: undefined,
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: undefined,
      COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: undefined,
    });
    expect(() => unbound.assertStripeTestReady()).toThrow('Product/Price binding');

    const live = configuredService({
      COMMERCIAL_STRIPE_SECRET_KEY: 'sk_live_forbidden',
    });
    expect(() => live.assertStripeTestReady()).toThrow('not test mode');
  });

  it('accepts the exact configured HTTPS customer portal origin only under every staging gate', () => {
    const service = configuredService({
      NODE_ENV: 'staging',
      PATROLSAFE_COMMERCIAL_STAGING: 'true',
      COMMERCIAL_LEAN_STAGING_PORTALS: 'true',
      CUSTOMER_PORTAL_ORIGIN: 'https://patrolsafe-commercial-staging.onrender.com',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://patrolsafe-commercial-staging.onrender.com/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=success',
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://patrolsafe-commercial-staging.onrender.com/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=cancelled',
    });

    const config = service.assertStripeTestReady();
    expect(config).toEqual(expect.objectContaining({ enabled: true }));
    expect(service.renderRedirectUrl(config.successUrlTemplate, 'ord_123/unsafe')).toBe(
      'https://patrolsafe-commercial-staging.onrender.com/patrolsafe/licence/status/ord_123%2Funsafe?checkout=success',
    );
  });

  it.each([
    ['NODE_ENV', { NODE_ENV: undefined }],
    ['PATROLSAFE_COMMERCIAL_STAGING', { PATROLSAFE_COMMERCIAL_STAGING: undefined }],
    ['COMMERCIAL_LEAN_STAGING_PORTALS', { COMMERCIAL_LEAN_STAGING_PORTALS: undefined }],
  ])('rejects the configured staging origin when the %s gate is absent', (_gate, missingGate) => {
    const service = configuredService({
      NODE_ENV: 'staging',
      PATROLSAFE_COMMERCIAL_STAGING: 'true',
      COMMERCIAL_LEAN_STAGING_PORTALS: 'true',
      CUSTOMER_PORTAL_ORIGIN: 'https://patrolsafe-commercial-staging.onrender.com',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://patrolsafe-commercial-staging.onrender.com/patrolsafe/licence/status/{ORDER_REFERENCE}',
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://patrolsafe-commercial-staging.onrender.com/patrolsafe/licence/status/{ORDER_REFERENCE}',
      ...missingGate,
    });

    expect(() => service.assertStripeTestReady()).toThrow('approved HTTPS portal URL');
  });

  it.each([
    'https://another-service.onrender.com/patrolsafe/licence/status/{ORDER_REFERENCE}',
    'http://patrolsafe-commercial-staging.onrender.com/patrolsafe/licence/status/{ORDER_REFERENCE}',
    'https://patrolsafe-commercial-staging.onrender.com:444/patrolsafe/licence/status/{ORDER_REFERENCE}',
    'https://attacker.example/patrolsafe/licence/status/{ORDER_REFERENCE}',
    'https://attacker.example/patrolsafe/licence/status/{ORDER_REFERENCE}?next=https%3A%2F%2Fpatrolsafe-commercial-staging.onrender.com',
    'https://attacker.example/patrolsafe/licence/status/{ORDER_REFERENCE}#https://patrolsafe-commercial-staging.onrender.com',
    'https://patrolsafe-commercial-staging.onrender.com@attacker.example/patrolsafe/licence/status/{ORDER_REFERENCE}',
    'not-a-url',
  ])('rejects an unsafe staging redirect: %s', (redirect) => {
    const service = configuredService({
      NODE_ENV: 'staging',
      PATROLSAFE_COMMERCIAL_STAGING: 'true',
      COMMERCIAL_LEAN_STAGING_PORTALS: 'true',
      CUSTOMER_PORTAL_ORIGIN: 'https://patrolsafe-commercial-staging.onrender.com',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: redirect,
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://patrolsafe-commercial-staging.onrender.com/patrolsafe/licence/status/{ORDER_REFERENCE}',
    });

    expect(() => service.assertStripeTestReady()).toThrow('approved HTTPS portal URL');
  });

  it('preserves the sfour.co.uk production redirect policy without enabling Render staging origins', () => {
    const production = configuredService({
      NODE_ENV: 'production',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://www.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://licensing.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
    });
    expect(production.assertStripeTestReady()).toEqual(expect.objectContaining({ enabled: true }));

    const renderInProduction = configuredService({
      NODE_ENV: 'production',
      PATROLSAFE_COMMERCIAL_STAGING: 'true',
      COMMERCIAL_LEAN_STAGING_PORTALS: 'true',
      CUSTOMER_PORTAL_ORIGIN: 'https://patrolsafe-commercial-staging.onrender.com',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://patrolsafe-commercial-staging.onrender.com/patrolsafe/licence/status/{ORDER_REFERENCE}',
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://patrolsafe-commercial-staging.onrender.com/patrolsafe/licence/status/{ORDER_REFERENCE}',
    });
    expect(() => renderInProduction.assertStripeTestReady()).toThrow('approved HTTPS portal URL');
  });

  it.each([
    'https://sfour.co.uk.evil.example/patrolsafe/licence/status/{ORDER_REFERENCE}',
    'https://sfour.co.uk@evil.example/patrolsafe/licence/status/{ORDER_REFERENCE}',
    'https://user:password@sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
    'https://sfour.co.uk:444/patrolsafe/licence/status/{ORDER_REFERENCE}',
  ])('rejects arbitrary redirect injection against the S4 allowlist: %s', (redirect) => {
    const service = configuredService({
      COMMERCIAL_CHECKOUT_SUCCESS_URL: redirect,
    });
    expect(() => service.assertStripeTestReady()).toThrow('approved HTTPS portal URL');
  });
});
