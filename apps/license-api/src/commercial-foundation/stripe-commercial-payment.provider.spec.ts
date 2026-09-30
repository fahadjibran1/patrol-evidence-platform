import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { CommercialConfigService } from './commercial-config.service';
import { StripeCommercialPaymentProvider } from './stripe-commercial-payment.provider';

describe('StripeCommercialPaymentProvider webhook boundary', () => {
  const secret = 'whsec_phase2_deterministic_test_secret';
  const config = new CommercialConfigService(new ConfigService({
    NODE_ENV: 'test',
    COMMERCIAL_STRIPE_ENABLED: 'true',
    COMMERCIAL_STRIPE_SECRET_KEY: 'sk_test_phase2_not_a_real_key',
    COMMERCIAL_STRIPE_WEBHOOK_SECRET: secret,
    COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase2_test',
    COMMERCIAL_STRIPE_PRICE_ID: 'price_phase2_test',
    COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
    COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
    COMMERCIAL_STRIPE_API_VERSION: '2024-11-20.acacia',
    COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
    COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
  }));

  it('accepts an authentic test-mode signature and returns only normalized data', () => {
    const provider = new StripeCommercialPaymentProvider(config);
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      id: 'evt_phase2_valid',
      object: 'event',
      api_version: '2024-11-20.acacia',
      created: timestamp,
      livemode: false,
      pending_webhooks: 1,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_phase2',
          object: 'checkout.session',
          client_reference_id: 'ord_phase2',
          metadata: { commercial_order_ref: 'ord_phase2' },
          payment_intent: 'pi_phase2',
          payment_status: 'paid',
          status: 'complete',
          amount_total: 29900,
          currency: 'gbp',
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
    const normalized = provider.verifyWebhook(Buffer.from(payload), signature);
    expect(normalized).toEqual(expect.objectContaining({
      providerEventId: 'evt_phase2_valid',
      livemode: false,
      publicOrderId: 'ord_phase2',
      checkoutSessionId: 'cs_test_phase2',
      paymentIntentId: 'pi_phase2',
      amountMinor: 29900,
      currency: 'GBP',
    }));
    expect(normalized).not.toHaveProperty('data');
  });

  it('rejects a forged signature', () => {
    const provider = new StripeCommercialPaymentProvider(config);
    expect(() => provider.verifyWebhook(Buffer.from('{}'), 'forged')).toThrow('signature is invalid');
  });

  it('rejects an authentic signature when the snapshot API version differs from the configured version', () => {
    const provider = new StripeCommercialPaymentProvider(config);
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      id: 'evt_wrong_version',
      object: 'event',
      api_version: '2026-08-26.dahlia',
      created: timestamp,
      livemode: false,
      pending_webhooks: 1,
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_wrong_version', object: 'checkout.session' } },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
    expect(() => provider.verifyWebhook(Buffer.from(payload), signature)).toThrow('API version is not accepted');
  });

  it('creates one-off Checkout with server input and a deterministic idempotency key', async () => {
    const provider = new StripeCommercialPaymentProvider(config);
    const create = jest.fn().mockResolvedValue({
      id: 'cs_test_created',
      url: 'https://checkout.stripe.test/cs_test_created',
      expires_at: null,
      livemode: false,
      status: 'open',
      payment_status: 'unpaid',
      payment_intent: null,
      customer: null,
      amount_total: 29900,
      currency: 'gbp',
      client_reference_id: 'ord_public',
      metadata: { commercial_order_ref: 'ord_public' },
    });
    const retrievePrice = jest.fn().mockResolvedValue({
      id: 'price_phase2_test',
      active: true,
      livemode: false,
      type: 'one_time',
      recurring: null,
      currency: 'gbp',
      unit_amount: 29900,
      tax_behavior: 'inclusive',
      lookup_key: 'patrolsafe_annual_gbp_v1',
      product: { id: 'prod_phase2_test', active: true, name: 'PatrolSafe Annual Licence' },
    });
    (provider as unknown as { client: unknown }).client = {
      prices: { retrieve: retrievePrice },
      checkout: { sessions: { create } },
    };
    await provider.createCheckout({
      commandId: 'checkout:order:1',
      publicOrderId: 'ord_public',
      customerEmail: 'buyer@example.test',
      customerName: 'Phase Two Patrols Ltd',
      productDisplayName: 'PatrolSafe Annual Licence',
      amountMinor: 29900,
      currency: 'GBP',
      successUrl: 'https://test.sfour.co.uk/success',
      cancelUrl: 'https://test.sfour.co.uk/cancel',
      metadata: { commercial_order_ref: 'ord_public', commercial_schema: '2' },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment',
      customer_creation: 'always',
      automatic_tax: { enabled: false },
      invoice_creation: { enabled: false },
      line_items: [{
        quantity: 1,
        price: 'price_phase2_test',
      }],
    }), { idempotencyKey: 'checkout:order:1' });
    expect(retrievePrice).toHaveBeenCalledWith('price_phase2_test', { expand: ['product'] });
  });

  it('rejects live Stripe objects in STAGING_TEST', async () => {
    const provider = new StripeCommercialPaymentProvider(config);
    (provider as unknown as { client: unknown }).client = {
      prices: { retrieve: jest.fn().mockResolvedValue({
        id: 'price_phase2_test', active: true, livemode: true, type: 'one_time', recurring: null,
        currency: 'gbp', unit_amount: 29900, tax_behavior: 'inclusive', lookup_key: 'patrolsafe_annual_gbp_v1',
        product: { id: 'prod_phase2_test', active: true, name: 'PatrolSafe Annual Licence' },
      }) },
      checkout: { sessions: { create: jest.fn() } },
    };
    await expect(provider.createCheckout({
      commandId: 'checkout:order:live-object', publicOrderId: 'ord_live_object',
      customerEmail: 'buyer@example.test', customerName: 'Test Ltd',
      productDisplayName: 'PatrolSafe Annual Licence', amountMinor: 29900, currency: 'GBP',
      successUrl: 'https://test.sfour.co.uk/success', cancelUrl: 'https://test.sfour.co.uk/cancel',
      metadata: { commercial_order_ref: 'ord_live_object' },
    })).rejects.toThrow('explicit mode');
  });

  it('fails closed when the configured sandbox Price does not match policy', async () => {
    const provider = new StripeCommercialPaymentProvider(config);
    (provider as unknown as { client: unknown }).client = {
      prices: { retrieve: jest.fn().mockResolvedValue({
        active: true,
        livemode: false,
        type: 'one_time',
        recurring: null,
        currency: 'gbp',
        unit_amount: 100,
        tax_behavior: 'inclusive',
        lookup_key: 'patrolsafe_annual_gbp_v1',
        product: { id: 'prod_phase2_test', active: true, name: 'PatrolSafe Annual Licence' },
      }) },
      checkout: { sessions: { create: jest.fn() } },
    };
    await expect(provider.createCheckout({
      commandId: 'checkout:order:mismatch',
      publicOrderId: 'ord_mismatch',
      customerEmail: 'buyer@example.test',
      customerName: 'Mismatch Ltd',
      productDisplayName: 'PatrolSafe Annual Licence',
      amountMinor: 29900,
      currency: 'GBP',
      successUrl: 'https://test.sfour.co.uk/success',
      cancelUrl: 'https://test.sfour.co.uk/cancel',
      metadata: { commercial_order_ref: 'ord_mismatch' },
    })).rejects.toThrow('does not match the server-owned commercial policy');
  });

  it('maps Dahlia-compatible Checkout and expanded PaymentIntent fields used for authoritative reconciliation', async () => {
    const provider = new StripeCommercialPaymentProvider(config);
    (provider as unknown as { client: unknown }).client = {
      checkout: { sessions: { retrieve: jest.fn().mockResolvedValue({
        id: 'cs_test_retrieved', url: null, expires_at: 1_800_000_000, livemode: false,
        status: 'complete', payment_status: 'paid', payment_intent: 'pi_test_retrieved',
        customer: 'cus_test_retrieved', amount_total: 29900, total_details: { amount_tax: 4983 },
        currency: 'gbp', metadata: { commercial_order_ref: 'ord_retrieved' },
        client_reference_id: 'ord_retrieved', customer_details: { address: { country: 'GB' } },
        invoice: 'in_test_retrieved',
      }) } },
      paymentIntents: { retrieve: jest.fn().mockResolvedValue({
        id: 'pi_test_retrieved', livemode: false, status: 'succeeded', amount: 29900,
        amount_received: 29900, latest_charge: { id: 'ch_test_retrieved', amount_refunded: 0 },
        currency: 'gbp', customer: 'cus_test_retrieved', metadata: { commercial_order_ref: 'ord_retrieved' },
      }) },
    };

    await expect(provider.retrieveCheckout('cs_test_retrieved')).resolves.toEqual(expect.objectContaining({
      providerSessionId: 'cs_test_retrieved', paymentIntentId: 'pi_test_retrieved',
      providerCustomerId: 'cus_test_retrieved', amountTotal: 29900, taxMinor: 4983,
      currency: 'GBP', publicOrderId: 'ord_retrieved', billingCountry: 'GB',
      providerInvoiceId: 'in_test_retrieved',
    }));
    await expect(provider.retrievePayment('pi_test_retrieved')).resolves.toEqual({
      paymentIntentId: 'pi_test_retrieved', livemode: false, status: 'succeeded', amount: 29900,
      amountReceived: 29900, amountRefunded: 0, currency: 'GBP',
      providerCustomerId: 'cus_test_retrieved', publicOrderId: 'ord_retrieved',
    });
  });
});

describe('StripeCommercialPaymentProvider Dahlia snapshot events', () => {
  const secret = 'whsec_dahlia_deterministic_test_secret';
  const config = new CommercialConfigService(new ConfigService({
    NODE_ENV: 'production',
    COMMERCIAL_MODE: 'PRODUCTION_LIVE',
    COMMERCIAL_STRIPE_ENABLED: 'true',
    COMMERCIAL_STRIPE_SECRET_KEY: 'rk_live_dahlia_not_a_real_key',
    COMMERCIAL_STRIPE_WEBHOOK_SECRET: secret,
    COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_live_dahlia',
    COMMERCIAL_STRIPE_PRICE_ID: 'price_live_dahlia',
    COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
    COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
    COMMERCIAL_STRIPE_API_VERSION: '2026-08-26.dahlia',
    COMMERCIAL_SERVICE_ORIGIN: 'https://licensing.sfour.co.uk',
    COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://licensing.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
    COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://licensing.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}',
    COMMERCIAL_UK_ONLY_ENABLED: 'true',
    COMMERCIAL_VAT_CONFIGURATION_APPROVED: 'true',
    COMMERCIAL_STRIPE_INVOICE_CREATION_ENABLED: 'true',
    COMMERCIAL_STRIPE_TAX_RATE_ID: 'txr_live_dahlia',
  }));

  const checkoutObject = {
    id: 'cs_live_dahlia', object: 'checkout.session', client_reference_id: 'ord_dahlia',
    metadata: { commercial_order_ref: 'ord_dahlia' }, payment_intent: 'pi_live_dahlia',
    customer: 'cus_live_dahlia', payment_status: 'paid', status: 'complete',
    amount_total: 29900, currency: 'gbp', customer_details: { address: { country: 'GB' } },
    invoice: 'in_live_dahlia',
  };
  const paymentIntentObject = {
    id: 'pi_live_dahlia', object: 'payment_intent', metadata: { commercial_order_ref: 'ord_dahlia' },
    customer: 'cus_live_dahlia', status: 'succeeded', amount: 29900, amount_received: 29900,
    currency: 'gbp', latest_charge: 'ch_live_dahlia',
  };
  const chargeObject = {
    id: 'ch_live_dahlia', object: 'charge', metadata: { commercial_order_ref: 'ord_dahlia' },
    payment_intent: 'pi_live_dahlia', customer: 'cus_live_dahlia', amount: 29900,
    amount_refunded: 29900, currency: 'gbp', refunded: true,
  };

  it.each([
    ['checkout.session.completed', checkoutObject, 'cs_live_dahlia', 'pi_live_dahlia'],
    ['checkout.session.async_payment_succeeded', checkoutObject, 'cs_live_dahlia', 'pi_live_dahlia'],
    ['checkout.session.async_payment_failed', { ...checkoutObject, payment_status: 'unpaid' }, 'cs_live_dahlia', 'pi_live_dahlia'],
    ['checkout.session.expired', { ...checkoutObject, status: 'expired', payment_status: 'unpaid' }, 'cs_live_dahlia', 'pi_live_dahlia'],
    ['payment_intent.succeeded', paymentIntentObject, null, 'pi_live_dahlia'],
    ['payment_intent.payment_failed', { ...paymentIntentObject, status: 'requires_payment_method' }, null, 'pi_live_dahlia'],
    ['payment_intent.canceled', { ...paymentIntentObject, status: 'canceled' }, null, 'pi_live_dahlia'],
    ['charge.refunded', chargeObject, null, 'pi_live_dahlia'],
  ])('accepts and normalizes %s as a 2026-08-26.dahlia snapshot', (type, object, checkoutId, paymentIntentId) => {
    const provider = new StripeCommercialPaymentProvider(config);
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      id: `evt_${String(type).replaceAll('.', '_')}`,
      object: 'event',
      api_version: '2026-08-26.dahlia',
      created: timestamp,
      livemode: true,
      pending_webhooks: 1,
      type,
      data: { object },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });

    expect(provider.verifyWebhook(Buffer.from(payload), signature)).toEqual(expect.objectContaining({
      type,
      livemode: true,
      publicOrderId: 'ord_dahlia',
      checkoutSessionId: checkoutId,
      paymentIntentId,
      providerCustomerId: 'cus_live_dahlia',
      amountMinor: 29900,
      currency: 'GBP',
    }));
  });
});
