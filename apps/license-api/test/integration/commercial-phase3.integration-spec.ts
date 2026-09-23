import { ConfigService } from '@nestjs/config';
import { AdminRole, CommercialOrderState, CommercialProvider, CommercialProviderMode } from '@prisma/client';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuditService } from '@/audit/audit.service';
import { AuthService } from '@/auth/auth.service';
import { EncryptionService } from '@/crypto/encryption.service';
import { CommercialPurchaseService } from '@/commercial-foundation/commercial-purchase.service';
import { CommercialCheckoutService } from '@/commercial-foundation/commercial-checkout.service';
import { CommercialConfigService } from '@/commercial-foundation/commercial-config.service';
import { CommercialStepUpService } from '@/commercial-foundation/commercial-step-up.service';
import { CommercialApprovalPreconditionsService } from '@/commercial-foundation/commercial-approval-preconditions.service';
import { CommercialIssuanceService } from '@/commercial-foundation/commercial-issuance.service';
import { CommercialPaymentReconciliationService } from '@/commercial-foundation/commercial-payment-reconciliation.service';
import { CurrentFormatCommercialLicenceIssuer } from '@/commercial-foundation/current-format-commercial-licence.issuer';
import type { CommercialSigningProvider } from '@/commercial-foundation/commercial-signing-provider.port';
import type { CommercialArtifactStore } from '@/commercial-foundation/commercial-artifact-store.port';
import type { CommercialPaymentProvider, CreateCommercialCheckoutCommand, CommercialCheckoutSnapshot, CommercialPaymentSnapshot } from '@/commercial-foundation/commercial-payment-provider.port';
import { parseSignedCommercialLicenceJson, verifyCommercialLicence } from '@patrol/license-core';
import { closeIntegrationContext, createIntegrationContext, resetIntegrationDatabase, type IntegrationContext } from './integration-harness';

class Phase3Provider implements CommercialPaymentProvider {
  readonly name = 'STRIPE' as const;
  sessions = new Map<string, CommercialCheckoutSnapshot>();
  payments = new Map<string, CommercialPaymentSnapshot>();
  getMode() { return 'TEST' as const; }
  async createCheckout(command: Readonly<CreateCommercialCheckoutCommand>) {
    const id = `cs_test_${randomUUID()}`;
    const value: CommercialCheckoutSnapshot = { providerSessionId: id, url: `https://checkout.stripe.test/${id}`, expiresAt: new Date(Date.now() + 600_000), livemode: false, status: 'open', paymentStatus: 'unpaid', paymentIntentId: null, providerCustomerId: 'cus_phase3', amountTotal: command.amountMinor, currency: command.currency, publicOrderId: command.publicOrderId };
    this.sessions.set(id, value);
    return value;
  }
  async retrieveCheckout(id: string) { return this.sessions.get(id)!; }
  async retrievePayment(id: string) { return this.payments.get(id)!; }
  verifyWebhook(): never { throw new Error('not used'); }
}

class Phase3Signer implements CommercialSigningProvider {
  readonly keyId = 'test-phase3-online-key';
  readonly pair = generateKeyPairSync('ed25519');
  async sign(bytes: Buffer) { return sign(null, bytes, this.pair.privateKey); }
  async verificationKey() { return this.pair.publicKey; }
}

class Phase3Store implements CommercialArtifactStore {
  values = new Map<string, Buffer>();
  failOnce = false;
  async putImmutable(input: { issuanceId: string; sha256: string; fileName: string; bytes: Buffer }) {
    if (this.failOnce) { this.failOnce = false; throw new Error('injected private storage outage'); }
    const key = `${input.issuanceId}/${input.sha256}/${input.fileName}`;
    const existing = this.values.get(key);
    if (existing && !existing.equals(input.bytes)) throw new Error('immutable collision');
    this.values.set(key, input.bytes);
    return { storageKey: key, byteSize: BigInt(input.bytes.length) };
  }
  async readVerified(input: { storageKey: string; sha256: string; byteSize: bigint }) {
    const bytes = this.values.get(input.storageKey);
    if (!bytes || BigInt(bytes.length) !== input.byteSize || createHash('sha256').update(bytes).digest('hex') !== input.sha256) throw new Error('integrity failure');
    return bytes;
  }
}

describe('commercial Phase 3 operator approval and isolated issuer', () => {
  let context: IntegrationContext;
  let provider: Phase3Provider;
  let store: Phase3Store;
  let signer: Phase3Signer;
  let issuance: CommercialIssuanceService;
  let stepUp: CommercialStepUpService;
  let config: CommercialConfigService;
  let admin: { sub: string; email: string; displayName: string; role: AdminRole };

  beforeAll(async () => { context = await createIntegrationContext(); });
  beforeEach(async () => {
    await resetIntegrationDatabase(context.prisma);
    provider = new Phase3Provider();
    store = new Phase3Store();
    signer = new Phase3Signer();
    const audit = context.module.get(AuditService);
    const auth = context.module.get(AuthService);
    config = new CommercialConfigService(new ConfigService({
      COMMERCIAL_STRIPE_ENABLED: 'true', COMMERCIAL_STRIPE_SECRET_KEY: 'sk_test_phase3', COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_phase3',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase3_test', COMMERCIAL_STRIPE_PRICE_ID: 'price_phase3_test',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1', COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=success',
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=cancelled',
    }));
    stepUp = new CommercialStepUpService(context.prisma, auth, audit);
    issuance = new CommercialIssuanceService(
      context.prisma,
      context.module.get(EncryptionService),
      audit,
      stepUp,
      new CommercialApprovalPreconditionsService(context.prisma, config, provider),
      new CurrentFormatCommercialLicenceIssuer(signer, store),
    );
    const record = await context.prisma.admin.create({ data: { email: 'operator@phase3.test', displayName: 'Phase 3 Operator', role: AdminRole.SUPER_ADMIN, passwordHash: await bcrypt.hash('Phase3OperatorPass!', 10) } });
    admin = { sub: record.id, email: record.email, displayName: record.displayName, role: record.role };
  });
  afterAll(async () => closeIntegrationContext(context));

  async function paidOrder(overrides: Record<string, unknown> = {}) {
    const purchases = context.module.get(CommercialPurchaseService);
    const config = new CommercialConfigService(new ConfigService({
      COMMERCIAL_STRIPE_ENABLED: 'true', COMMERCIAL_STRIPE_SECRET_KEY: 'sk_test_phase3', COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_phase3',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase3_test', COMMERCIAL_STRIPE_PRICE_ID: 'price_phase3_test',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1', COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=success',
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://test.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=cancelled',
    }));
    const checkout = new CommercialCheckoutService(context.prisma, context.module.get(AuditService), config, provider);
    const request = await purchases.createPurchaseRequest({ requestId: randomUUID(), schemaVersion: 2, product: 'Patrol Evidence Platform', plan: 'annual', installationId: randomUUID(), machineFingerprint: 'c'.repeat(64), companyName: 'Phase Three Patrols Ltd', appVersion: '1.0.3', buildId: 'phase3-test', clientNonce: `nonce_${randomUUID().replace(/-/g, '')}`, ...overrides });
    const session = await checkout.createFromOpaqueReference(request.purchaseReference, { customerEmail: 'buyer@phase3.test', contactName: 'Test Buyer' });
    const paymentId = `pi_test_${randomUUID()}`;
    provider.sessions.set(session.providerSessionId, { ...provider.sessions.get(session.providerSessionId)!, status: 'complete', paymentStatus: 'paid', paymentIntentId: paymentId });
    provider.payments.set(paymentId, { paymentIntentId: paymentId, livemode: false, status: 'succeeded', amount: 29900, amountReceived: 29900, amountRefunded: 0, currency: 'GBP', providerCustomerId: 'cus_phase3', publicOrderId: request.publicOrderId });
    const order = await context.prisma.commercialOrder.update({ where: { publicOrderId: request.publicOrderId }, data: { state: CommercialOrderState.PAID_AWAITING_APPROVAL, providerPaymentIntentId: paymentId, checkoutStatus: 'complete' } });
    await context.prisma.commercialPayment.create({ data: { orderId: order.id, provider: CommercialProvider.STRIPE, providerReference: paymentId, providerMode: CommercialProviderMode.TEST, checkoutSessionId: session.providerSessionId, providerCustomerId: 'cus_phase3', status: 'SUCCEEDED', amountMinor: 29900, currency: 'GBP', paidAt: new Date() } });
    return order;
  }

  async function token() { return (await stepUp.create(admin, 'Phase3OperatorPass!')).stepUpToken; }

  it('atomically approves, queues, issues and stores exactly one current .tglic without delivery', async () => {
    const order = await paidOrder();
    const approved = await issuance.approve({ publicOrderId: order.publicOrderId, admin, stepUpToken: await token() });
    const completed = await issuance.processApprovedIssuance(approved.id);
    const repeated = await issuance.processApprovedIssuance(approved.id);
    expect(completed.idempotent).toBe(false);
    expect(repeated.idempotent).toBe(true);
    expect(await context.prisma.commercialLicenceIssuance.count({ where: { orderId: order.id } })).toBe(1);
    expect(await context.prisma.commercialLicenceArtifact.count()).toBe(1);
    expect(await context.prisma.commercialDeliveryAttempt.count()).toBe(0);
    const bytes = store.values.get(completed.artifact.storageKey)!;
    const licence = parseSignedCommercialLicenceJson(bytes.toString('utf8'))!;
    expect(verifyCommercialLicence({ licence, publicKey: signer.pair.publicKey, installationId: licence.payload.installationId, machineFingerprint: licence.payload.machineFingerprint, today: licence.payload.startsAt }).valid).toBe(true);
    expect(licence.payload).toEqual(expect.objectContaining({ product: 'Patrol Evidence Platform', plan: 'annual', maxDevices: 1, companyName: 'Phase Three Patrols Ltd' }));
    expect(await context.prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.id } })).toEqual(expect.objectContaining({ state: CommercialOrderState.ISSUED }));
    const auditJson = JSON.stringify(await context.prisma.auditLog.findMany({ where: { entityId: approved.id } }));
    expect(auditJson).not.toContain('c'.repeat(64));
    expect(auditJson).not.toContain(licence.signature);
  });

  it('allows only one concurrent initial approval and one issuance', async () => {
    const order = await paidOrder();
    const secondRecord = await context.prisma.admin.create({ data: { email: 'operator-2@phase3.test', displayName: 'Second Operator', role: AdminRole.SUPER_ADMIN, passwordHash: await bcrypt.hash('SecondOperatorPass!', 10) } });
    const secondAdmin = { sub: secondRecord.id, email: secondRecord.email, displayName: secondRecord.displayName, role: secondRecord.role };
    const [firstToken, secondToken] = await Promise.all([token(), stepUp.create(secondAdmin, 'SecondOperatorPass!').then((value) => value.stepUpToken)]);
    const results = await Promise.allSettled([
      issuance.approve({ publicOrderId: order.publicOrderId, admin, stepUpToken: firstToken }),
      issuance.approve({ publicOrderId: order.publicOrderId, admin: secondAdmin, stepUpToken: secondToken }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(await context.prisma.commercialLicenceIssuance.count({ where: { orderId: order.id } })).toBe(1);
    expect(await context.prisma.commercialOutboxEvent.count({ where: { eventType: 'commercial.issuance.requested' } })).toBe(1);
  });

  it('fails closed without step-up and makes hold/reject explicit without refunding', async () => {
    const order = await paidOrder();
    await expect(stepUp.create(admin, 'WrongOperatorPassword!')).rejects.toMatchObject({ code: 'COMMERCIAL_STEP_UP_INVALID' });
    await expect(issuance.approve({ publicOrderId: order.publicOrderId, admin })).rejects.toMatchObject({ code: 'COMMERCIAL_STEP_UP_REQUIRED' });
    await issuance.hold(order.publicOrderId, 'Manual risk review', admin, await token());
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.id } })).state).toBe('HELD');
    await issuance.releaseHold(order.publicOrderId, 'Review completed', admin, await token());
    await issuance.reject(order.publicOrderId, 'Order identity rejected', admin, await token());
    const rejected = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(rejected.state).toBe('REJECTED');
    expect(rejected.refundedAt).toBeNull();
    expect(await context.prisma.commercialLicenceIssuance.count()).toBe(0);
  });

  it('recovers deterministically after private artifact storage fails', async () => {
    const order = await paidOrder();
    const approved = await issuance.approve({ publicOrderId: order.publicOrderId, admin, stepUpToken: await token() });
    store.failOnce = true;
    await expect(issuance.processApprovedIssuance(approved.id)).rejects.toThrow('injected private storage outage');
    expect((await context.prisma.commercialLicenceIssuance.findUniqueOrThrow({ where: { id: approved.id } })).status).toBe('FAILED');
    const recovered = await issuance.processApprovedIssuance(approved.id);
    expect(recovered.issuance.status).toBe('ISSUED');
    expect(store.values.size).toBe(1);
  });

  it('refuses to sign an approved issuance that becomes held before the worker runs', async () => {
    const order = await paidOrder();
    const approved = await issuance.approve({ publicOrderId: order.publicOrderId, admin, stepUpToken: await token() });
    await context.prisma.commercialOrder.update({ where: { id: order.id }, data: { state: CommercialOrderState.HELD, heldFromState: CommercialOrderState.ISSUANCE_PENDING, holdReason: 'refund_race', stateVersion: { increment: 1 } } });
    await expect(issuance.processApprovedIssuance(approved.id)).rejects.toMatchObject({ code: 'COMMERCIAL_APPROVAL_PRECONDITION_FAILED' });
    expect(store.values.size).toBe(0);
    expect(await context.prisma.commercialLicenceArtifact.count()).toBe(0);
    expect(await context.prisma.auditLog.count({ where: { action: 'commercial.issuance.blocked', entityId: approved.id } })).toBe(1);
  });

  it('denies ordinary ADMIN approval even when an order is paid', async () => {
    const order = await paidOrder();
    await expect(issuance.approve({ publicOrderId: order.publicOrderId, admin: { ...admin, role: AdminRole.ADMIN }, stepUpToken: 'x'.repeat(43) })).rejects.toMatchObject({ code: 'COMMERCIAL_OPERATOR_FORBIDDEN' });
    expect(await context.prisma.commercialLicenceIssuance.count()).toBe(0);
  });

  it('rejects expired/replayed step-up, tampered references, and a refunded approval race', async () => {
    const order = await paidOrder();
    const expired = await token();
    await context.prisma.commercialOperatorStepUp.updateMany({ data: { expiresAt: new Date(Date.now() - 1_000) } });
    await expect(issuance.approve({ publicOrderId: order.publicOrderId, admin, stepUpToken: expired })).rejects.toMatchObject({ code: 'COMMERCIAL_STEP_UP_INVALID' });
    await expect(issuance.getApproval('ord_unknown_reference', admin)).rejects.toMatchObject({ code: 'COMMERCIAL_ORDER_NOT_FOUND' });
    const request = await context.prisma.commercialPurchaseRequest.findUniqueOrThrow({ where: { id: order.purchaseRequestId } });
    await context.prisma.commercialOrder.update({ where: { id: order.id }, data: { requestHashSnapshot: 'd'.repeat(64) } });
    await expect(issuance.approve({ publicOrderId: order.publicOrderId, admin, stepUpToken: await token() })).rejects.toMatchObject({ code: 'COMMERCIAL_APPROVAL_PRECONDITION_FAILED' });
    expect(await context.prisma.auditLog.count({ where: { action: 'commercial.approval.denied', entityId: order.id } })).toBe(2);
    await context.prisma.commercialOrder.update({ where: { id: order.id }, data: { requestHashSnapshot: request.canonicalRequestHash } });
    const paymentId = (await context.prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.id } })).providerPaymentIntentId!;
    provider.payments.set(paymentId, { ...provider.payments.get(paymentId)!, amountRefunded: 29900 });
    await expect(issuance.approve({ publicOrderId: order.publicOrderId, admin, stepUpToken: await token() })).rejects.toMatchObject({ code: 'COMMERCIAL_APPROVAL_PRECONDITION_FAILED' });
    expect(await context.prisma.commercialLicenceIssuance.count()).toBe(0);
  });

  it('returns only a safe workstation summary to the operator review view', async () => {
    const order = await paidOrder();
    const review = await issuance.getApproval(order.publicOrderId, admin);
    const json = JSON.stringify(review);
    expect(json).not.toContain('c'.repeat(64));
    expect(json).not.toContain('machineFingerprint');
    expect(review.workstationSummary).toMatch(/^\.\.\.[a-f0-9]{8}$/);
  });

  it('starts an early renewal after the predecessor expiry without shortening entitlement', async () => {
    const initial = await paidOrder();
    const first = await issuance.approve({ publicOrderId: initial.publicOrderId, admin, stepUpToken: await token() });
    await issuance.processApprovedIssuance(first.id);
    const renewalOrder = await paidOrder({ previousLicenceId: first.licenceId });
    const renewal = await issuance.approve({ publicOrderId: renewalOrder.publicOrderId, admin, stepUpToken: await token() });
    const expectedStart = new Date(first.expiresAt!);
    expectedStart.setUTCDate(expectedStart.getUTCDate() + 1);
    expect(renewal.startsAt?.toISOString().slice(0, 10)).toBe(expectedStart.toISOString().slice(0, 10));
  });

  it('flags a post-issuance refund for manual handling without claiming offline revocation', async () => {
    const order = await paidOrder();
    const approved = await issuance.approve({ publicOrderId: order.publicOrderId, admin, stepUpToken: await token() });
    await issuance.processApprovedIssuance(approved.id);
    const storedOrder = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.id } });
    const paymentId = storedOrder.providerPaymentIntentId!;
    provider.payments.set(paymentId, { ...provider.payments.get(paymentId)!, amountRefunded: 29900 });
    const providerEvent = await context.prisma.commercialProviderEvent.create({ data: {
      provider: CommercialProvider.STRIPE, providerEventId: `evt_refund_${randomUUID()}`, eventType: 'charge.refunded', payloadHash: createHash('sha256').update('phase3-refund').digest('hex'),
      safeMetadata: { publicOrderId: order.publicOrderId, checkoutSessionId: storedOrder.providerCheckoutSessionId, paymentIntentId: paymentId }, livemode: false,
    } });
    const outbox = await context.prisma.commercialOutboxEvent.create({ data: {
      eventId: randomUUID(), idempotencyKey: `phase3-refund:${providerEvent.id}`, aggregateType: 'CommercialProviderEvent', aggregateId: providerEvent.id,
      eventType: 'commercial.provider_event.received', payload: { providerEventId: providerEvent.id }, correlationId: randomUUID(),
    } });
    await new CommercialPaymentReconciliationService(context.prisma, context.module.get(AuditService), config, provider).reconcileOutboxEvent(outbox.id);
    const reviewed = await context.prisma.commercialLicenceIssuance.findUniqueOrThrow({ where: { id: approved.id } });
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.id } })).state).toBe('HELD');
    expect(reviewed.commercialReviewRequired).toBe(true);
    expect(reviewed.postIssuanceRefundAt).not.toBeNull();
    expect(reviewed.status).toBe('ISSUED');
    expect(await context.prisma.commercialLicenceArtifact.count({ where: { issuanceId: approved.id } })).toBe(1);
  });
});
