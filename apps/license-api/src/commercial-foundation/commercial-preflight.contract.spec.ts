import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('production commercial preflight read-only contract', () => {
  const mainSource = readFileSync(join(__dirname, '..', 'commercial-preflight.main.ts'), 'utf8');
  const stripeSource = readFileSync(join(__dirname, 'stripe-commercial-payment.provider.ts'), 'utf8');

  it('has no database, Checkout, issuance, licence-storage, or email-send dependency', () => {
    expect(mainSource).not.toMatch(/PrismaService|CommercialCheckoutService|CommercialLicenceIssuer|CommercialArtifactStore/);
    expect(mainSource).not.toMatch(/createCheckout|\.send\s*\(|issue\s*\(|createOrder/);
    expect(mainSource).toContain('productionReadOnlyPreflight');
    expect(mainSource).toContain('configurationPreflight');
    expect(mainSource).toContain("safeLine('PREFLIGHT_MUTATIONS_PERFORMED', false)");
  });

  it('limits Stripe preflight to Price/Product and TaxRate retrieval', () => {
    const method = stripeSource.slice(
      stripeSource.indexOf('async productionReadOnlyPreflight'),
      stripeSource.indexOf('async createCheckout'),
    );
    expect(method).toContain('stripe.prices.retrieve');
    expect(method).toContain('stripe.taxRates.retrieve');
    expect(method).not.toMatch(/\.create\s*\(|\.update\s*\(|\.del\s*\(|\.cancel\s*\(|\.refund/);
  });

  it('allows only privacy-safe output labels', () => {
    const labels = [...mainSource.matchAll(/safeLine\('([^']+)'/g)].map((match) => match[1]);
    expect(labels.length).toBeGreaterThan(10);
    expect(labels.filter((label) => /SECRET|PRIVATE|PEM|DATABASE|JWT|WEBHOOK|CREDENTIAL_VALUE|API_KEY/.test(label)))
      .toEqual(['RESEND_API_KEY_FORMAT_VALID', 'RESEND_WEBHOOK_SECRET_FORMAT_VALID']);
  });
});
