import { StripePaymentProvider } from './stripe-payment.provider';
import { StripeConfigService } from './stripe-config.service';

describe('StripePaymentProvider mapping', () => {
  const config = {
    getConfig: () => ({
      enabled: true,
      secretKey: 'sk_test_dummy',
      publishableKey: 'pk_test_dummy',
      webhookSecret: 'whsec_dummy',
      apiVersion: '2024-11-20.acacia',
      successUrl: 'http://localhost/success',
      cancelUrl: 'http://localhost/cancel',
      portalReturnUrl: 'http://localhost/billing',
      gracePeriodDays: 7,
      currentTermsVersion: '2026-07-01',
      webhookMaxAttempts: 8,
    }),
    getMode: () => 'TEST' as const,
    assertReadyForCheckout: () => config.getConfig(),
    getSafeStatus: () => ({ enabled: true, mode: 'TEST', configured: true }),
  } as unknown as StripeConfigService;

  it('maps provider subscription statuses without exposing Stripe enums', () => {
    const provider = new StripePaymentProvider(config);
    expect(provider.mapProviderSubscriptionStatus('active')).toBe('ACTIVE');
    expect(provider.mapProviderSubscriptionStatus('past_due')).toBe('PAST_DUE');
    expect(provider.mapProviderSubscriptionStatus('canceled')).toBe('CANCELLED');
    expect(provider.mapProviderSubscriptionStatus('unpaid')).toBe('PAST_DUE');
    expect(provider.mapProviderSubscriptionStatus('trialing')).toBe('TRIAL');
  });

  it('reports TEST mode for sk_test keys', () => {
    const provider = new StripePaymentProvider(config);
    expect(provider.getMode()).toBe('TEST');
    expect(provider.name).toBe('STRIPE');
    expect(provider.isEnabled()).toBe(true);
  });
});
