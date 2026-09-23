import 'reflect-metadata';
import { validateEnv } from './validate-env';

const base = {
  NODE_ENV: 'staging',
  LICENSE_DATABASE_URL: 'postgresql://phase6a.test/staging',
  JWT_SECRET: 'x'.repeat(32),
  LICENCE_STORAGE_ENCRYPTION_KEY: 'a'.repeat(64),
  LICENSE_SIGNING_KEY_ID: 'test-phase6-online-key',
};

describe('commercial staging environment validation', () => {
  it('accepts an explicitly bound Stripe sandbox policy', () => {
    expect(validateEnv({
      ...base,
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_not_a_real_secret',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase6a',
      COMMERCIAL_STRIPE_PRICE_ID: 'price_phase6a',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
      COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
    })).toEqual(expect.objectContaining({ COMMERCIAL_STRIPE_PRICE_ID: 'price_phase6a' }));
  });

  it('rejects live Stripe credentials', () => {
    expect(() => validateEnv({
      ...base,
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'sk_live_forbidden',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_not_a_real_secret',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase6a',
      COMMERCIAL_STRIPE_PRICE_ID: 'price_phase6a',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
      COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
    })).toThrow('Stripe TEST secret key');
  });

  it('rejects an unbound or non-inclusive sandbox Price policy', () => {
    expect(() => validateEnv({
      ...base,
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_not_a_real_secret',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase6a',
      COMMERCIAL_STRIPE_PRICE_ID: 'price_phase6a',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
      COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'exclusive',
    })).toThrow('tax behaviour must be explicitly inclusive');
  });
});
