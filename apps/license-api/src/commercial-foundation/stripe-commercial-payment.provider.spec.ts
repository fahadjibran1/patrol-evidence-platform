import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { CommercialConfigService } from './commercial-config.service';
import { StripeCommercialPaymentProvider } from './stripe-commercial-payment.provider';

describe('StripeCommercialPaymentProvider webhook boundary', () => {
  const secret = 'whsec_phase2_deterministic_test_secret';
  const config = new CommercialConfigService(new ConfigService({
    COMMERCIAL_STRIPE_ENABLED: 'true',
    COMMERCIAL_STRIPE_SECRET_KEY: 'sk_test_phase2_not_a_real_key',
    COMMERCIAL_STRIPE_WEBHOOK_SECRET: secret,
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
    (provider as unknown as { client: unknown }).client = { checkout: { sessions: { create } } };
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
        price_data: {
          currency: 'gbp',
          unit_amount: 29900,
          product_data: { name: 'PatrolSafe Annual Licence' },
        },
      }],
    }), { idempotencyKey: 'checkout:order:1' });
  });
});
