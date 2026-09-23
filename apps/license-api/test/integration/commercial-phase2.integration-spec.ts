import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommercialOrderState,
  CommercialPaymentStatus,
  OutboxEventStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { AuditService } from '@/audit/audit.service';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { ApiException } from '@/common/exceptions/api.exception';
import { CommercialCheckoutService } from '@/commercial-foundation/commercial-checkout.service';
import { CommercialConfigService } from '@/commercial-foundation/commercial-config.service';
import { CommercialOutboxWorkerService } from '@/commercial-foundation/commercial-outbox-worker.service';
import type {
  CommercialCheckoutSnapshot,
  CommercialPaymentProvider,
  CommercialPaymentSnapshot,
  CreateCommercialCheckoutCommand,
  VerifiedCommercialProviderEvent,
} from '@/commercial-foundation/commercial-payment-provider.port';
import { CommercialPaymentReconciliationService } from '@/commercial-foundation/commercial-payment-reconciliation.service';
import { CommercialPurchaseService } from '@/commercial-foundation/commercial-purchase.service';
import { CommercialWebhookService } from '@/commercial-foundation/commercial-webhook.service';
import { CommercialCheckoutDto } from '@/commercial-foundation/dto/commercial-checkout.dto';
import {
  closeIntegrationContext,
  createIntegrationContext,
  resetIntegrationDatabase,
  type IntegrationContext,
} from './integration-harness';

function purchaseRequest(overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    schemaVersion: 2,
    product: 'Patrol Evidence Platform',
    plan: 'annual',
    installationId: randomUUID(),
    machineFingerprint: 'a'.repeat(64),
    companyName: 'Phase Two Patrols Ltd',
    appVersion: '1.0.3',
    buildId: '2026.09.22.phase2',
    clientNonce: `nonce_${randomUUID().replace(/-/g, '')}`,
    ...overrides,
  };
}

class FakeStripeProvider implements CommercialPaymentProvider {
  readonly name = 'STRIPE' as const;
  createCalls: Readonly<CreateCommercialCheckoutCommand>[] = [];
  sessions = new Map<string, CommercialCheckoutSnapshot>();
  payments = new Map<string, CommercialPaymentSnapshot>();
  event: VerifiedCommercialProviderEvent | null = null;
  failCreate = false;
  failRetrieveOnce = false;
  private commands = new Map<string, string>();

  getMode() { return 'TEST' as const; }

  async createCheckout(command: Readonly<CreateCommercialCheckoutCommand>) {
    if (this.failCreate) throw new Error('provider unavailable: secret must not be logged');
    this.createCalls.push(command);
    const existingId = this.commands.get(command.commandId);
    if (existingId) return this.sessions.get(existingId)!;
    const id = `cs_test_${this.sessions.size + 1}`;
    const snapshot: CommercialCheckoutSnapshot = {
      providerSessionId: id,
      url: `https://checkout.stripe.test/${id}`,
      expiresAt: new Date(Date.now() + 30 * 60_000),
      livemode: false,
      status: 'open',
      paymentStatus: 'unpaid',
      paymentIntentId: null,
      providerCustomerId: null,
      amountTotal: command.amountMinor,
      currency: command.currency,
      publicOrderId: command.publicOrderId,
    };
    this.commands.set(command.commandId, id);
    this.sessions.set(id, snapshot);
    return snapshot;
  }

  async retrieveCheckout(id: string) {
    if (this.failRetrieveOnce) {
      this.failRetrieveOnce = false;
      throw new Error('injected worker crash');
    }
    const snapshot = this.sessions.get(id);
    if (!snapshot) throw new Error('checkout not found');
    return snapshot;
  }

  async retrievePayment(id: string) {
    const snapshot = this.payments.get(id);
    if (!snapshot) throw new Error('payment not found');
    return snapshot;
  }

  verifyWebhook(_rawBody: Buffer, signature: string) {
    if (signature !== 'valid-test-signature' || !this.event) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_WEBHOOK_INVALID, 'Stripe webhook signature is invalid.', 400);
    }
    return this.event;
  }
}

describe('commercial Phase 2 Stripe payment foundation', () => {
  let context: IntegrationContext;
  let purchases: CommercialPurchaseService;
  let audit: AuditService;
  let provider: FakeStripeProvider;
  let config: CommercialConfigService;
  let checkout: CommercialCheckoutService;
  let webhooks: CommercialWebhookService;
  let reconciliation: CommercialPaymentReconciliationService;
  let worker: CommercialOutboxWorkerService;

  beforeAll(async () => {
    context = await createIntegrationContext();
    purchases = context.module.get(CommercialPurchaseService);
    audit = context.module.get(AuditService);
  });

  beforeEach(async () => {
    await resetIntegrationDatabase(context.prisma);
    provider = new FakeStripeProvider();
    config = new CommercialConfigService(new ConfigService({
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'sk_test_phase2_not_a_real_key',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_phase2_not_a_real_secret',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase2_test',
      COMMERCIAL_STRIPE_PRICE_ID: 'price_phase2_test',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
      COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=success',
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=cancelled',
    }));
    checkout = new CommercialCheckoutService(context.prisma, audit, config, provider);
    webhooks = new CommercialWebhookService(context.prisma, audit, provider);
    reconciliation = new CommercialPaymentReconciliationService(context.prisma, audit, config, provider);
    worker = new CommercialOutboxWorkerService(context.prisma, config, reconciliation);
  });

  afterAll(async () => closeIntegrationContext(context));

  async function createCheckout() {
    const created = await purchases.createPurchaseRequest(purchaseRequest());
    const result = await checkout.createFromOpaqueReference(created.purchaseReference, {
      customerEmail: 'buyer@example.test',
      contactName: 'Pat Buyer',
    });
    return { created, result };
  }

  function event(
    id: string,
    type: string,
    ids: { orderId: string; sessionId: string; paymentId?: string },
    overrides: Partial<VerifiedCommercialProviderEvent> = {},
  ): VerifiedCommercialProviderEvent {
    return {
      providerEventId: id,
      type,
      livemode: false,
      createdAt: new Date(),
      objectId: ids.sessionId,
      objectType: 'checkout.session',
      publicOrderId: ids.orderId,
      checkoutSessionId: ids.sessionId,
      paymentIntentId: ids.paymentId ?? null,
      providerCustomerId: 'cus_phase2',
      status: 'complete',
      paymentStatus: 'paid',
      amountMinor: 29900,
      currency: 'GBP',
      ...overrides,
    };
  }

  function settledSnapshots(sessionId: string, orderId: string, paymentId = 'pi_phase2') {
    provider.sessions.set(sessionId, {
      ...provider.sessions.get(sessionId)!,
      status: 'complete',
      paymentStatus: 'paid',
      paymentIntentId: paymentId,
      providerCustomerId: 'cus_phase2',
    });
    provider.payments.set(paymentId, {
      paymentIntentId: paymentId,
      livemode: false,
      status: 'succeeded',
      amount: 29900,
      amountReceived: 29900,
      amountRefunded: 0,
      currency: 'GBP',
      providerCustomerId: 'cus_phase2',
      publicOrderId: orderId,
    });
  }

  it('creates one idempotent test Checkout using only server-owned commercial terms', async () => {
    const { created, result } = await createCheckout();
    const duplicate = await checkout.createFromOpaqueReference(created.purchaseReference, {
      customerEmail: 'ignored@example.test',
      contactName: 'Ignored',
    });
    expect(result.amountMinor).toBe(29900);
    expect(result.currency).toBe('GBP');
    expect(duplicate.duplicate).toBe(true);
    expect(provider.createCalls).toHaveLength(1);
    expect(provider.createCalls[0]).toEqual(expect.objectContaining({
      amountMinor: 29900,
      currency: 'GBP',
      productDisplayName: 'PatrolSafe Annual Licence',
    }));
    expect(provider.createCalls[0].metadata).toEqual({
      commercial_order_ref: created.publicOrderId,
      commercial_schema: '2',
    });
    expect(JSON.stringify(provider.createCalls[0])).not.toContain('a'.repeat(64));
    expect(JSON.stringify(provider.createCalls[0])).not.toContain(created.purchaseReference);
    const stored = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } });
    expect(stored).toEqual(expect.objectContaining({
      state: CommercialOrderState.CHECKOUT_PENDING,
      amountMinor: 29900,
      currency: 'GBP',
      checkoutGeneration: 1,
    }));
  });

  it('replaces an expired Checkout safely while retaining one active session', async () => {
    const { created, result } = await createCheckout();
    provider.sessions.set(result.providerSessionId, {
      ...provider.sessions.get(result.providerSessionId)!,
      status: 'expired',
      expiresAt: new Date(Date.now() - 1000),
    });
    provider.failCreate = true;
    await expect(checkout.createFromOpaqueReference(created.purchaseReference, {
      customerEmail: 'buyer@example.test',
    })).rejects.toMatchObject({ code: ERROR_CODES.COMMERCIAL_CHECKOUT_FAILED });
    expect(await context.prisma.commercialCheckoutSession.count({ where: { isActive: true } })).toBe(1);
    provider.failCreate = false;
    const replacement = await checkout.createFromOpaqueReference(created.purchaseReference, {
      customerEmail: 'buyer@example.test',
    });
    expect(replacement.providerSessionId).not.toBe(result.providerSessionId);
    expect(await context.prisma.commercialCheckoutSession.count({ where: { isActive: true } })).toBe(1);
    expect(await context.prisma.commercialCheckoutSession.count()).toBe(2);
  });

  it('fails closed and audits a provider outage without creating ambiguous payment state', async () => {
    const created = await purchases.createPurchaseRequest(purchaseRequest());
    provider.failCreate = true;
    await expect(checkout.createFromOpaqueReference(created.purchaseReference, {
      customerEmail: 'buyer@example.test',
    })).rejects.toMatchObject({ code: ERROR_CODES.COMMERCIAL_CHECKOUT_FAILED });
    expect(await context.prisma.commercialCheckoutSession.count()).toBe(0);
    expect(await context.prisma.auditLog.count({ where: { action: 'commercial.checkout.provider_failed' } })).toBe(1);
  });

  it('recovers from a DB failure after provider creation through the same provider idempotency key', async () => {
    const created = await purchases.createPurchaseRequest(purchaseRequest());
    const transaction = jest.spyOn(context.prisma, '$transaction');
    transaction.mockRejectedValueOnce(new Error('injected commit failure'));
    await expect(checkout.createFromOpaqueReference(created.purchaseReference, {
      customerEmail: 'buyer@example.test',
    })).rejects.toThrow('injected commit failure');
    transaction.mockRestore();
    const retry = await checkout.createFromOpaqueReference(created.purchaseReference, {
      customerEmail: 'buyer@example.test',
    });
    expect(retry.providerSessionId).toBe('cs_test_1');
    expect(provider.createCalls).toHaveLength(2);
    expect(new Set(provider.createCalls.map((call) => call.commandId)).size).toBe(1);
    expect(await context.prisma.commercialCheckoutSession.count()).toBe(1);
  });

  it('rejects expired requests and invalid product/plan input before contacting Stripe', async () => {
    const expired = await purchases.createPurchaseRequest(purchaseRequest(), new Date('2026-01-01T00:00:00Z'));
    await expect(checkout.createFromOpaqueReference(expired.purchaseReference, {
      customerEmail: 'buyer@example.test',
    }, new Date('2026-01-01T01:00:00Z'))).rejects.toMatchObject({
      code: ERROR_CODES.COMMERCIAL_REFERENCE_EXPIRED,
    });

    await expect(purchases.createPurchaseRequest(purchaseRequest({ product: 'Wrong product' })))
      .rejects.toMatchObject({ code: ERROR_CODES.COMMERCIAL_REQUEST_INVALID });
    await expect(purchases.createPurchaseRequest(purchaseRequest({ plan: 'subscription' })))
      .rejects.toMatchObject({ code: ERROR_CODES.COMMERCIAL_REQUEST_INVALID });
    expect(provider.createCalls).toHaveLength(0);
  });

  it('rejects client price, currency, and Price ID fields at the strict HTTP DTO boundary', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const value = plainToInstance(CommercialCheckoutDto, {
      customerEmail: 'buyer@example.test',
      amount: 1,
      currency: 'USD',
      stripePriceId: 'price_attacker',
    });
    await expect(pipe.transform(value, { type: 'body', metatype: CommercialCheckoutDto })).rejects.toBeDefined();
  });

  it('persists a verified event before durable processing and deduplicates provider retries', async () => {
    const { created, result } = await createCheckout();
    provider.event = event('evt_phase2_duplicate', 'checkout.session.completed', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
    });
    const first = await webhooks.ingest(Buffer.from('{"safe":1}'), 'valid-test-signature');
    const second = await webhooks.ingest(Buffer.from('{"safe":1}'), 'valid-test-signature');
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(await context.prisma.commercialProviderEvent.count()).toBe(1);
    expect(await context.prisma.commercialOutboxEvent.count({
      where: { eventType: 'commercial.provider_event.received', status: OutboxEventStatus.PENDING },
    })).toBe(1);
    const beforeWorker = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } });
    expect(beforeWorker.state).toBe(CommercialOrderState.CHECKOUT_PENDING);
  });

  it('does not acknowledge persistence when the webhook database transaction fails', async () => {
    const { created, result } = await createCheckout();
    provider.event = event('evt_phase2_db_retry', 'checkout.session.completed', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
    });
    const transaction = jest.spyOn(context.prisma, '$transaction');
    transaction.mockRejectedValueOnce(new Error('injected webhook database outage'));
    await expect(webhooks.ingest(Buffer.from('{"event":"db-retry"}'), 'valid-test-signature'))
      .rejects.toThrow('injected webhook database outage');
    transaction.mockRestore();
    expect(await context.prisma.commercialProviderEvent.count()).toBe(0);
    await expect(webhooks.ingest(Buffer.from('{"event":"db-retry"}'), 'valid-test-signature'))
      .resolves.toEqual(expect.objectContaining({ received: true, duplicate: false }));
  });

  it('rejects missing, forged, and live-mode webhook events without changing an order', async () => {
    const { created, result } = await createCheckout();
    provider.event = event('evt_phase2_live', 'checkout.session.completed', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
    }, { livemode: true });
    await expect(webhooks.ingest(Buffer.from('{}'), undefined)).rejects.toMatchObject({
      code: ERROR_CODES.COMMERCIAL_WEBHOOK_INVALID,
    });
    await expect(webhooks.ingest(Buffer.from('{}'), 'forged')).rejects.toMatchObject({
      code: ERROR_CODES.COMMERCIAL_WEBHOOK_INVALID,
    });
    await expect(webhooks.ingest(Buffer.from('{}'), 'valid-test-signature')).rejects.toMatchObject({
      code: ERROR_CODES.COMMERCIAL_WEBHOOK_MODE_MISMATCH,
    });
    expect(await context.prisma.commercialProviderEvent.count()).toBe(0);
  });

  it('reconciles authoritative settlement exactly to PAID_AWAITING_APPROVAL and invokes no issuer/delivery path', async () => {
    const { created, result } = await createCheckout();
    settledSnapshots(result.providerSessionId, created.publicOrderId);
    provider.event = event('evt_phase2_paid', 'checkout.session.completed', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
      paymentId: 'pi_phase2',
    });
    await webhooks.ingest(Buffer.from('{"event":"paid"}'), 'valid-test-signature');
    expect(await worker.processPending()).toEqual({ processed: 1, failed: 0 });
    const order = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } });
    expect(order.state).toBe(CommercialOrderState.PAID_AWAITING_APPROVAL);
    expect(await context.prisma.commercialPayment.findFirst()).toEqual(expect.objectContaining({
      status: CommercialPaymentStatus.SUCCEEDED,
      amountMinor: 29900,
      currency: 'GBP',
    }));
    expect(await context.prisma.commercialLicenceIssuance.count()).toBe(0);
    expect(await context.prisma.commercialLicenceArtifact.count()).toBe(0);
    expect(await context.prisma.commercialDeliveryAttempt.count()).toBe(0);
  });

  it('keeps delayed payment pending, then converges on paid despite stale out-of-order delivery', async () => {
    const { created, result } = await createCheckout();
    provider.event = event('evt_phase2_pending', 'checkout.session.async_payment_pending', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
    }, { paymentStatus: 'unpaid' });
    await webhooks.ingest(Buffer.from('{"event":"pending"}'), 'valid-test-signature');
    await worker.processPending();
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } })).state)
      .toBe(CommercialOrderState.PAYMENT_PENDING);

    settledSnapshots(result.providerSessionId, created.publicOrderId);
    provider.event = event('evt_phase2_async_paid', 'checkout.session.async_payment_succeeded', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
      paymentId: 'pi_phase2',
    });
    await webhooks.ingest(Buffer.from('{"event":"settled"}'), 'valid-test-signature');
    await worker.processPending();
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } })).state)
      .toBe(CommercialOrderState.PAID_AWAITING_APPROVAL);

    provider.event = event('evt_phase2_stale', 'checkout.session.async_payment_pending', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
    });
    await webhooks.ingest(Buffer.from('{"event":"stale"}'), 'valid-test-signature');
    await worker.processPending();
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } })).state)
      .toBe(CommercialOrderState.PAID_AWAITING_APPROVAL);
  });

  it('holds an amount mismatch and never treats metadata alone as payment authority', async () => {
    const { created, result } = await createCheckout();
    settledSnapshots(result.providerSessionId, created.publicOrderId);
    provider.payments.set('pi_phase2', { ...provider.payments.get('pi_phase2')!, amount: 1, amountReceived: 1 });
    provider.event = event('evt_phase2_mismatch', 'checkout.session.completed', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
      paymentId: 'pi_phase2',
    });
    await webhooks.ingest(Buffer.from('{"event":"mismatch"}'), 'valid-test-signature');
    await worker.processPending();
    const order = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } });
    expect(order.state).toBe(CommercialOrderState.HELD);
    expect(order.holdReason).toBe('payment_amount_mismatch');
  });

  it('holds wrong-order and currency mismatches instead of advancing payment', async () => {
    const { created, result } = await createCheckout();
    settledSnapshots(result.providerSessionId, created.publicOrderId);
    provider.sessions.set(result.providerSessionId, {
      ...provider.sessions.get(result.providerSessionId)!,
      publicOrderId: `ord_${randomUUID()}`,
    });
    provider.event = event('evt_phase2_wrong_order', 'checkout.session.completed', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
      paymentId: 'pi_phase2',
    });
    await webhooks.ingest(Buffer.from('{"event":"wrong-order"}'), 'valid-test-signature');
    await worker.processPending();
    let order = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } });
    expect(order.state).toBe(CommercialOrderState.HELD);
    expect(order.holdReason).toBe('checkout_order_mismatch');

    await resetIntegrationDatabase(context.prisma);
    const second = await createCheckout();
    settledSnapshots(second.result.providerSessionId, second.created.publicOrderId);
    provider.payments.set('pi_phase2', { ...provider.payments.get('pi_phase2')!, currency: 'USD' });
    provider.event = event('evt_phase2_currency', 'payment_intent.succeeded', {
      orderId: second.created.publicOrderId,
      sessionId: second.result.providerSessionId,
      paymentId: 'pi_phase2',
    });
    await webhooks.ingest(Buffer.from('{"event":"currency"}'), 'valid-test-signature');
    await worker.processPending();
    order = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: second.created.publicOrderId } });
    expect(order.state).toBe(CommercialOrderState.HELD);
    expect(order.holdReason).toBe('payment_currency_mismatch');
  });

  it('keeps failed and expired Checkout non-paid and safely ignores an unknown event', async () => {
    const { created, result } = await createCheckout();
    provider.event = event('evt_phase2_failed', 'payment_intent.payment_failed', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
    }, { paymentStatus: 'unpaid' });
    await webhooks.ingest(Buffer.from('{"event":"failed"}'), 'valid-test-signature');
    await worker.processPending();
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } })).state)
      .toBe(CommercialOrderState.PAYMENT_PENDING);

    provider.sessions.set(result.providerSessionId, {
      ...provider.sessions.get(result.providerSessionId)!,
      status: 'expired',
      paymentStatus: 'unpaid',
      expiresAt: new Date(Date.now() - 1_000),
    });
    provider.event = event('evt_phase2_expired', 'checkout.session.expired', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
    }, { status: 'expired', paymentStatus: 'unpaid' });
    await webhooks.ingest(Buffer.from('{"event":"expired"}'), 'valid-test-signature');
    await worker.processPending();
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } })).state)
      .toBe(CommercialOrderState.PAYMENT_PENDING);

    provider.event = event('evt_phase2_unknown', 'customer.created', {
      orderId: '',
      sessionId: '',
    }, { publicOrderId: null, checkoutSessionId: null, paymentIntentId: null });
    await webhooks.ingest(Buffer.from('{"event":"unknown"}'), 'valid-test-signature');
    await worker.processPending();
    expect(await context.prisma.commercialProviderEvent.count({ where: { status: 'IGNORED' } })).toBe(1);
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } })).state)
      .toBe(CommercialOrderState.PAYMENT_PENDING);
  });

  it('marks a pre-issuance refund terminal without creating issuance', async () => {
    const { created, result } = await createCheckout();
    settledSnapshots(result.providerSessionId, created.publicOrderId);
    provider.event = event('evt_phase2_paid_first', 'payment_intent.succeeded', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
      paymentId: 'pi_phase2',
    });
    await webhooks.ingest(Buffer.from('{"event":"paid-first"}'), 'valid-test-signature');
    await worker.processPending();

    provider.payments.set('pi_phase2', { ...provider.payments.get('pi_phase2')!, amountRefunded: 29900 });
    provider.event = event('evt_phase2_refund', 'charge.refunded', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
      paymentId: 'pi_phase2',
    });
    await webhooks.ingest(Buffer.from('{"event":"refund"}'), 'valid-test-signature');
    await worker.processPending();
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } })).state)
      .toBe(CommercialOrderState.REFUNDED);
    expect(await context.prisma.commercialLicenceIssuance.count()).toBe(0);
  });

  it('recovers durably after an injected worker crash and processes the same event once', async () => {
    const { created, result } = await createCheckout();
    settledSnapshots(result.providerSessionId, created.publicOrderId);
    provider.event = event('evt_phase2_retry', 'checkout.session.completed', {
      orderId: created.publicOrderId,
      sessionId: result.providerSessionId,
      paymentId: 'pi_phase2',
    });
    await webhooks.ingest(Buffer.from('{"event":"retry"}'), 'valid-test-signature');
    provider.failRetrieveOnce = true;
    expect(await worker.processPending()).toEqual({ processed: 0, failed: 1 });
    await context.prisma.commercialOutboxEvent.updateMany({
      where: { eventType: 'commercial.provider_event.received' },
      data: { availableAt: new Date(0) },
    });
    expect(await worker.processPending()).toEqual({ processed: 1, failed: 0 });
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } })).state)
      .toBe(CommercialOrderState.PAID_AWAITING_APPROVAL);
    expect(await context.prisma.commercialPayment.count()).toBe(1);
  });

  it('enforces database uniqueness for one active Checkout per order', async () => {
    const { created } = await createCheckout();
    const order = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } });
    await expect(context.prisma.commercialCheckoutSession.create({
      data: {
        orderId: order.id,
        provider: 'STRIPE',
        providerMode: 'TEST',
        providerSessionId: 'cs_test_second_active',
        generation: 2,
        status: 'open',
        isActive: true,
        amountMinor: 29900,
        currency: 'GBP',
      },
    })).rejects.toMatchObject({ code: 'P2002' });
  });
});
