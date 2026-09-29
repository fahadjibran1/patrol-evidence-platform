import 'reflect-metadata';
import { validateEnv } from './validate-env';

const base = {
  NODE_ENV: 'staging',
  PATROLSAFE_COMMERCIAL_STAGING: 'true',
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

  it('accepts a restricted Stripe sandbox key', () => {
    expect(validateEnv({
      ...base,
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'rk_test_restricted_not_a_real_key',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_not_a_real_secret',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase6b',
      COMMERCIAL_STRIPE_PRICE_ID: 'price_phase6b',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
      COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
    })).toEqual(expect.objectContaining({ COMMERCIAL_STRIPE_SECRET_KEY: 'rk_test_restricted_not_a_real_key' }));
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
    })).toThrow('does not match the explicit commercial mode');
  });

  it('rejects restricted live Stripe credentials', () => {
    expect(() => validateEnv({
      ...base,
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'rk_live_forbidden',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_not_a_real_secret',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase6b',
      COMMERCIAL_STRIPE_PRICE_ID: 'price_phase6b',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
      COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
    })).toThrow('does not match the explicit commercial mode');
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

  it('requires the staging marker and rejects lean portals in production', () => {
    expect(() => validateEnv({
      ...base,
      PATROLSAFE_COMMERCIAL_STAGING: undefined,
      COMMERCIAL_LEAN_STAGING_PORTALS: 'true',
    })).toThrow('explicit commercial staging marker');
    expect(() => validateEnv({
      ...base,
      NODE_ENV: 'production',
      COMMERCIAL_LEAN_STAGING_PORTALS: 'true',
      PATROLSAFE_COMMERCIAL_STAGING: 'true',
    })).toThrow('forbidden in production');
  });

  it('requires explicit production mode and rejects staging cross-contamination', () => {
    expect(() => validateEnv({
      ...base,
      NODE_ENV: 'production',
      COMMERCIAL_MODE: 'STAGING_TEST',
      PATROLSAFE_COMMERCIAL_STAGING: undefined,
      COMMERCIAL_STRIPE_ENABLED: 'false',
    })).toThrow('STAGING_TEST commercial mode is forbidden in production');

    expect(() => validateEnv({
      ...base,
      NODE_ENV: 'production',
      COMMERCIAL_MODE: 'DISABLED',
      PATROLSAFE_COMMERCIAL_STAGING: 'true',
    })).toThrow('Staging/test commercial configuration is forbidden in production');

    expect(() => validateEnv({
      ...base,
      NODE_ENV: 'production',
      COMMERCIAL_MODE: 'DISABLED',
      PATROLSAFE_COMMERCIAL_STAGING: undefined,
      COMMERCIAL_STRIPE_SECRET_KEY: 'rk_test_not_a_real_key',
    })).toThrow('Stripe test credentials are forbidden in production');
  });

  it('keeps production live fail-closed until the production signer exists', () => {
    expect(() => validateEnv({
      ...base,
      NODE_ENV: 'production',
      PATROLSAFE_COMMERCIAL_STAGING: undefined,
      LICENSE_DATABASE_URL: 'postgresql://db.production.internal/patrolsafe',
      COMMERCIAL_MODE: 'PRODUCTION_LIVE',
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'rk_live_not_a_real_key',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_not_a_real_secret',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_live_placeholder',
      COMMERCIAL_STRIPE_PRICE_ID: 'price_live_placeholder',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
      COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
      COMMERCIAL_DATABASE_ENVIRONMENT: 'production',
      COMMERCIAL_SERVICE_ORIGIN: 'https://licensing.sfour.co.uk',
      LICENSE_PORTAL_ORIGIN: 'https://licensing.sfour.co.uk',
      CUSTOMER_PORTAL_ORIGIN: 'https://licensing.sfour.co.uk',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://licensing.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=success',
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://licensing.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=cancelled',
      COMMERCIAL_LICENCE_DOWNLOAD_BASE_URL: 'https://licensing.sfour.co.uk/commercial/licence/download',
      COMMERCIAL_UK_ONLY_ENABLED: 'true',
      COMMERCIAL_VAT_CONFIGURATION_APPROVED: 'true',
      COMMERCIAL_STRIPE_INVOICE_CREATION_ENABLED: 'true',
      COMMERCIAL_STRIPE_TAX_RATE_ID: 'txr_live_placeholder',
      COMMERCIAL_ARTIFACT_STORE: 'database',
      COMMERCIAL_STRIPE_API_VERSION: '2024-11-20.acacia',
      COMMERCIAL_OUTBOX_WORKER_ENABLED: 'true',
      COMMERCIAL_DELIVERY_PROVIDER: 'resend',
      COMMERCIAL_RESEND_ENABLED: 'true',
      COMMERCIAL_RESEND_API_KEY: 're_not_a_real_key',
      COMMERCIAL_RESEND_FROM: 'PatrolSafe <licensing@example.test>',
      COMMERCIAL_RESEND_WEBHOOK_SECRET: 'whsec_not_a_real_resend_secret',
      COMMERCIAL_DELIVERY_TOKEN_SECRET: 'd'.repeat(32),
      COMMERCIAL_TERMS_VERSION: '2026-09-29',
      COMMERCIAL_PRIVACY_VERSION: '2026-09-29',
      COMMERCIAL_SIGNING_PROVIDER: 'external-ed25519',
      COMMERCIAL_PRODUCTION_SIGNING_KEY_ID: 'patrolsafe-prod-2026-01',
    })).toThrow('Production commercial signing provider is not implemented');
  });

});
