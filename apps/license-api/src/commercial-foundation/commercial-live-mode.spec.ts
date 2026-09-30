import { ConfigService } from '@nestjs/config';
import { CommercialConfigService } from './commercial-config.service';
import { StripeCommercialPaymentProvider } from './stripe-commercial-payment.provider';

describe('production live Stripe mode boundary', () => {
  function provider() {
    const config = new CommercialConfigService(new ConfigService({
      NODE_ENV: 'production',
      COMMERCIAL_MODE: 'PRODUCTION_LIVE',
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'rk_live_not_a_real_key',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_not_a_real_secret',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_live_expected',
      COMMERCIAL_STRIPE_PRICE_ID: 'price_live_expected',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
      COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
      COMMERCIAL_STRIPE_API_VERSION: '2026-08-26.dahlia',
      COMMERCIAL_SERVICE_ORIGIN: 'https://licensing.sfour.co.uk',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://licensing.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://licensing.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
      COMMERCIAL_UK_ONLY_ENABLED: 'true',
      COMMERCIAL_VAT_CONFIGURATION_APPROVED: 'true',
      COMMERCIAL_STRIPE_INVOICE_CREATION_ENABLED: 'true',
      COMMERCIAL_STRIPE_TAX_RATE_ID: 'txr_live_expected',
    }));
    return new StripeCommercialPaymentProvider(config);
  }

  const command = {
    commandId: 'checkout:production:1',
    publicOrderId: 'ord_production',
    customerEmail: 'buyer@example.test',
    customerName: 'UK Business Ltd',
    productDisplayName: 'PatrolSafe Annual Licence' as const,
    amountMinor: 29900,
    currency: 'GBP',
    successUrl: 'https://licensing.sfour.co.uk/success',
    cancelUrl: 'https://licensing.sfour.co.uk/cancel',
    metadata: { commercial_order_ref: 'ord_production' },
  };

  function price(livemode: boolean) {
    return {
      id: 'price_live_expected', active: true, livemode, type: 'one_time', recurring: null,
      currency: 'gbp', unit_amount: 29900, tax_behavior: 'inclusive', lookup_key: 'patrolsafe_annual_gbp_v1',
      product: { id: 'prod_live_expected', active: true, name: 'PatrolSafe Annual Licence' },
    };
  }

  it('rejects test-mode Stripe objects in PRODUCTION_LIVE', async () => {
    const subject = provider();
    (subject as unknown as { client: unknown }).client = {
      prices: { retrieve: jest.fn().mockResolvedValue(price(false)) },
      checkout: { sessions: { create: jest.fn() } },
    };
    await expect(subject.createCheckout(command)).rejects.toThrow('explicit mode');
  });

  it('creates an invoice-ready UK Checkout only for validated live objects', async () => {
    const subject = provider();
    const create = jest.fn().mockResolvedValue({
      id: 'cs_live_created', url: 'https://checkout.stripe.com/c/pay/cs_live_created', livemode: true,
      status: 'open', payment_status: 'unpaid', amount_total: 29900, currency: 'gbp',
      client_reference_id: 'ord_production', metadata: { commercial_order_ref: 'ord_production' },
    });
    (subject as unknown as { client: unknown }).client = {
      prices: { retrieve: jest.fn().mockResolvedValue(price(true)) },
      checkout: { sessions: { create } },
    };
    await expect(subject.createCheckout(command)).resolves.toEqual(expect.objectContaining({ livemode: true }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment',
      billing_address_collection: 'required',
      automatic_tax: { enabled: false },
      tax_id_collection: { enabled: false },
      invoice_creation: { enabled: true, invoice_data: { metadata: command.metadata } },
      line_items: [{ quantity: 1, price: 'price_live_expected', tax_rates: ['txr_live_expected'] }],
    }), { idempotencyKey: command.commandId });
  });

  it('fails closed if production is configured for Acacia or the Dahlia preview channel', async () => {
    for (const apiVersion of ['2024-11-20.acacia', '2026-08-26.preview']) {
      const config = new CommercialConfigService(new ConfigService({
        NODE_ENV: 'production', COMMERCIAL_MODE: 'PRODUCTION_LIVE', COMMERCIAL_STRIPE_ENABLED: 'true',
        COMMERCIAL_STRIPE_SECRET_KEY: 'rk_live_not_a_real_key',
        COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_not_a_real_secret',
        COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_live_expected', COMMERCIAL_STRIPE_PRICE_ID: 'price_live_expected',
        COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
        COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive', COMMERCIAL_STRIPE_API_VERSION: apiVersion,
        COMMERCIAL_SERVICE_ORIGIN: 'https://licensing.sfour.co.uk',
        COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://licensing.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
        COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://licensing.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
        COMMERCIAL_UK_ONLY_ENABLED: 'true', COMMERCIAL_VAT_CONFIGURATION_APPROVED: 'true',
        COMMERCIAL_STRIPE_INVOICE_CREATION_ENABLED: 'true', COMMERCIAL_STRIPE_TAX_RATE_ID: 'txr_live_expected',
      }));
      expect(() => config.assertStripeReady()).toThrow('Stripe API');
    }
  });
});
