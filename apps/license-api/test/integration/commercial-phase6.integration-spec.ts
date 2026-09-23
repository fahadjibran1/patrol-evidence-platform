import { ConfigService } from '@nestjs/config';
import { AdminRole, CommercialOrderState } from '@prisma/client';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as bcrypt from 'bcrypt';
import { parseSignedCommercialLicenceJson, verifyCommercialLicenceWithTrustRing } from '@patrol/license-core';
import { AuditService } from '@/audit/audit.service';
import { AuthService } from '@/auth/auth.service';
import { EncryptionService } from '@/crypto/encryption.service';
import { CommercialPurchaseService } from '@/commercial-foundation/commercial-purchase.service';
import { CommercialCheckoutService } from '@/commercial-foundation/commercial-checkout.service';
import { CommercialConfigService } from '@/commercial-foundation/commercial-config.service';
import { CommercialWebhookService } from '@/commercial-foundation/commercial-webhook.service';
import { CommercialPaymentReconciliationService } from '@/commercial-foundation/commercial-payment-reconciliation.service';
import { CommercialApprovalPreconditionsService } from '@/commercial-foundation/commercial-approval-preconditions.service';
import { CommercialStepUpService } from '@/commercial-foundation/commercial-step-up.service';
import { CommercialIssuanceService } from '@/commercial-foundation/commercial-issuance.service';
import { CurrentFormatCommercialLicenceIssuer } from '@/commercial-foundation/current-format-commercial-licence.issuer';
import { TestFileEd25519SigningProvider } from '@/commercial-foundation/test-file-ed25519-signing.provider';
import { PrivateTestArtifactStore } from '@/commercial-foundation/private-test-artifact.store';
import { CommercialDeliveryTokenService } from '@/commercial-foundation/commercial-delivery-token.service';
import { CommercialDeliveryService } from '@/commercial-foundation/commercial-delivery.service';
import { CommercialOutboxWorkerService } from '@/commercial-foundation/commercial-outbox-worker.service';
import type { CommercialDeliveryProvider, CommercialDeliveryProviderEvent, SendCommercialLicenceEmailCommand } from '@/commercial-foundation/commercial-delivery-provider.port';
import type { CommercialCheckoutSnapshot, CommercialPaymentProvider, CommercialPaymentSnapshot, CreateCommercialCheckoutCommand, VerifiedCommercialProviderEvent } from '@/commercial-foundation/commercial-payment-provider.port';
import { closeIntegrationContext, createIntegrationContext, resetIntegrationDatabase, type IntegrationContext } from './integration-harness';

class StagingStripeHarness implements CommercialPaymentProvider {
  readonly name = 'STRIPE' as const;
  readonly sessions = new Map<string, CommercialCheckoutSnapshot>();
  readonly payments = new Map<string, CommercialPaymentSnapshot>();
  event: VerifiedCommercialProviderEvent | null = null;
  getMode() { return 'TEST' as const; }
  async createCheckout(command: Readonly<CreateCommercialCheckoutCommand>) {
    const providerSessionId = `cs_test_${randomUUID()}`;
    const snapshot: CommercialCheckoutSnapshot = { providerSessionId, url: `https://checkout.stripe.test/${providerSessionId}`, expiresAt: new Date(Date.now() + 30 * 60_000), livemode: false, status: 'open', paymentStatus: 'unpaid', paymentIntentId: null, providerCustomerId: 'cus_phase6_test', amountTotal: command.amountMinor, currency: command.currency, publicOrderId: command.publicOrderId };
    this.sessions.set(providerSessionId, snapshot);
    return snapshot;
  }
  async retrieveCheckout(id: string) { return this.sessions.get(id)!; }
  async retrievePayment(id: string) { return this.payments.get(id)!; }
  verifyWebhook(_raw: Buffer, signature: string) {
    if (signature !== 'phase6-valid-test-signature' || !this.event) throw new Error('forged Stripe test webhook');
    return this.event;
  }
  settle(providerSessionId: string, publicOrderId: string) {
    const paymentIntentId = `pi_test_${randomUUID()}`;
    this.sessions.set(providerSessionId, { ...this.sessions.get(providerSessionId)!, status: 'complete', paymentStatus: 'paid', paymentIntentId, providerCustomerId: 'cus_phase6_test' });
    this.payments.set(paymentIntentId, { paymentIntentId, livemode: false, status: 'succeeded', amount: 29900, amountReceived: 29900, amountRefunded: 0, currency: 'GBP', providerCustomerId: 'cus_phase6_test', publicOrderId });
    this.event = { providerEventId: `evt_test_${randomUUID()}`, type: 'checkout.session.completed', livemode: false, createdAt: new Date(), objectId: providerSessionId, objectType: 'checkout.session', publicOrderId, checkoutSessionId: providerSessionId, paymentIntentId, providerCustomerId: 'cus_phase6_test', status: 'complete', paymentStatus: 'paid', amountMinor: 29900, currency: 'GBP' };
  }
}

class StagingResendHarness implements CommercialDeliveryProvider {
  readonly name = 'resend' as const;
  readonly sends: Readonly<SendCommercialLicenceEmailCommand>[] = [];
  async send(command: Readonly<SendCommercialLicenceEmailCommand>) {
    this.sends.push(command);
    return { messageId: `email_test_${command.attemptId}`, acceptedAt: new Date() };
  }
  verifyWebhook(rawBody: Buffer, headers: Readonly<Record<string, string | undefined>>): CommercialDeliveryProviderEvent {
    if (headers['phase6-signature'] !== 'valid') throw new Error('forged Resend test webhook');
    const input = JSON.parse(rawBody.toString('utf8')) as Omit<CommercialDeliveryProviderEvent, 'occurredAt'> & { occurredAt: string };
    return { ...input, occurredAt: new Date(input.occurredAt) };
  }
}

describe('commercial Phase 6 deterministic end-to-end staging journey', () => {
  let context: IntegrationContext;
  let stagingRoot: string;
  let stripe: StagingStripeHarness;
  let resend: StagingResendHarness;
  let purchases: CommercialPurchaseService;
  let checkout: CommercialCheckoutService;
  let webhooks: CommercialWebhookService;
  let issuance: CommercialIssuanceService;
  let delivery: CommercialDeliveryService;
  let worker: CommercialOutboxWorkerService;
  let stepUp: CommercialStepUpService;
  let signer: TestFileEd25519SigningProvider;
  let artifacts: PrivateTestArtifactStore;
  let admin: { sub: string; email: string; displayName: string; role: AdminRole };

  beforeAll(async () => { context = await createIntegrationContext(); });
  beforeEach(async () => {
    await resetIntegrationDatabase(context.prisma);
    stagingRoot = mkdtempSync(join(tmpdir(), 'patrolsafe-phase6-staging-'));
    const pair = generateKeyPairSync('ed25519');
    const keyPath = join(stagingRoot, 'UNMISTAKABLY-TEST-ONLY-ed25519-private.pem');
    writeFileSync(keyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const configValues = {
      NODE_ENV: 'test',
      COMMERCIAL_STRIPE_ENABLED: 'true',
      COMMERCIAL_STRIPE_SECRET_KEY: 'sk_test_phase6_deterministic_harness',
      COMMERCIAL_STRIPE_WEBHOOK_SECRET: 'whsec_phase6_deterministic_harness',
      COMMERCIAL_STRIPE_PRODUCT_ID: 'prod_phase6_test',
      COMMERCIAL_STRIPE_PRICE_ID: 'price_phase6_test',
      COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY: 'patrolsafe_annual_gbp_v1',
      COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR: 'inclusive',
      COMMERCIAL_CHECKOUT_SUCCESS_URL: 'https://staging.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=success',
      COMMERCIAL_CHECKOUT_CANCEL_URL: 'https://staging.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=cancelled',
      COMMERCIAL_TEST_ISSUER_ENABLED: 'true',
      COMMERCIAL_TEST_SIGNING_KEY_ID: 'test-phase6-online-key',
      COMMERCIAL_TEST_SIGNING_PRIVATE_KEY_FILE: keyPath,
      COMMERCIAL_TEST_ARTIFACT_ROOT: join(stagingRoot, 'private-artifacts'),
      COMMERCIAL_DELIVERY_TOKEN_SECRET: randomBytes(32).toString('base64'),
      COMMERCIAL_LICENCE_DOWNLOAD_BASE_URL: 'https://staging-licensing.sfour.co.uk/commercial/licence/download',
    };
    const config = new ConfigService(configValues);
    const policy = new CommercialConfigService(config);
    const audit = context.module.get(AuditService);
    stripe = new StagingStripeHarness();
    resend = new StagingResendHarness();
    purchases = context.module.get(CommercialPurchaseService);
    checkout = new CommercialCheckoutService(context.prisma, audit, policy, stripe);
    webhooks = new CommercialWebhookService(context.prisma, audit, stripe);
    const reconciliation = new CommercialPaymentReconciliationService(context.prisma, audit, policy, stripe);
    stepUp = new CommercialStepUpService(context.prisma, context.module.get(AuthService), audit);
    signer = new TestFileEd25519SigningProvider(config);
    artifacts = new PrivateTestArtifactStore(config);
    issuance = new CommercialIssuanceService(context.prisma, context.module.get(EncryptionService), audit, stepUp, new CommercialApprovalPreconditionsService(context.prisma, policy, stripe), new CurrentFormatCommercialLicenceIssuer(signer, artifacts));
    delivery = new CommercialDeliveryService(context.prisma, audit, new CommercialDeliveryTokenService(config), stepUp, artifacts, resend);
    worker = new CommercialOutboxWorkerService(context.prisma, policy, reconciliation, issuance, delivery);
    const record = await context.prisma.admin.create({ data: { email: 'operator@phase6.test', displayName: 'Phase 6 Staging Operator', role: AdminRole.SUPER_ADMIN, passwordHash: await bcrypt.hash('Phase6StagingPass!', 10) } });
    admin = { sub: record.id, email: record.email, displayName: record.displayName, role: record.role };
  });
  afterEach(() => rmSync(stagingRoot, { recursive: true, force: true }));
  afterAll(async () => closeIntegrationContext(context));

  async function paidOrder(input: { previousLicenceId?: string; machine?: string; company?: string } = {}) {
    const machineFingerprint = input.machine ?? '6'.repeat(64);
    const created = await purchases.createPurchaseRequest({ requestId: randomUUID(), schemaVersion: 2, product: 'Patrol Evidence Platform', plan: 'annual', installationId: randomUUID(), machineFingerprint, companyName: input.company ?? 'Phase Six Patrols Ltd', appVersion: '1.0.3', buildId: 'phase6-local-e2e', clientNonce: `nonce_${randomUUID().replace(/-/g, '')}`, previousLicenceId: input.previousLicenceId });
    const session = await checkout.createFromOpaqueReference(created.purchaseReference, { customerEmail: 'product-owner@phase6.test', contactName: 'Phase 6 Product Owner' });
    stripe.settle(session.providerSessionId, created.publicOrderId);
    await webhooks.ingest(Buffer.from('{"phase6":"paid"}'), 'phase6-valid-test-signature', randomUUID());
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await worker.processPending(10);
      const order = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } });
      if (order.state === CommercialOrderState.PAID_AWAITING_APPROVAL) break;
    }
    return { created, session, machineFingerprint };
  }

  async function approve(publicOrderId: string) {
    const auth = await stepUp.create(admin, 'Phase6StagingPass!', randomUUID());
    return issuance.approve({ publicOrderId, admin, stepUpToken: auth.stepUpToken, correlationId: randomUUID() });
  }

  it('runs payment through approval, one immutable current-format licence, delivery and download', async () => {
    const path = await paidOrder();
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: path.created.publicOrderId } })).state).toBe(CommercialOrderState.PAID_AWAITING_APPROVAL);
    const approved = await approve(path.created.publicOrderId);
    expect(approved.deliveryRecipient).toBe('product-owner@phase6.test');
    expect(await worker.processPending(10)).toEqual({ processed: 1, failed: 0 });
    expect(await worker.processPending(10)).toEqual({ processed: 1, failed: 0 });
    expect(resend.sends).toHaveLength(1);
    const rawToken = new URL(resend.sends[0].downloadUrl).pathname.split('/').pop()!;
    const downloaded = await delivery.download(rawToken, { ipAddress: '127.0.0.1', userAgent: 'phase6-local-e2e' });
    const parsed = parseSignedCommercialLicenceJson(downloaded.bytes.toString('utf8'))!;
    const verified = verifyCommercialLicenceWithTrustRing({ licence: parsed, trustedKeys: [{ keyId: signer.keyId, publicKey: await signer.verificationKey(), policy: 'online-annual-v1' }], installationId: parsed.payload.installationId, machineFingerprint: path.machineFingerprint, today: parsed.payload.startsAt, expectedProduct: 'Patrol Evidence Platform' });
    expect(verified).toEqual(expect.objectContaining({ valid: true, signingKeyId: 'test-phase6-online-key' }));
    expect(parsed.payload).toEqual(expect.objectContaining({ product: 'Patrol Evidence Platform', plan: 'annual', companyName: 'Phase Six Patrols Ltd', maxDevices: 1 }));
    expect(downloaded.sha256).toBe(createHash('sha256').update(downloaded.bytes).digest('hex'));
    expect(await artifacts.readVerified({ storageKey: (await context.prisma.commercialLicenceArtifact.findFirstOrThrow()).storageKey, sha256: downloaded.sha256, byteSize: BigInt(downloaded.bytes.length) })).toEqual(downloaded.bytes);
    expect(await issuance.processApprovedIssuance(approved.id)).toEqual(expect.objectContaining({ idempotent: true }));
    expect(await context.prisma.commercialLicenceIssuance.count({ where: { orderId: approved.orderId } })).toBe(1);
    expect(await context.prisma.commercialLicenceArtifact.count({ where: { issuanceId: approved.id } })).toBe(1);
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: path.created.publicOrderId } })).state).toBe(CommercialOrderState.DELIVERED);
    const persistence = JSON.stringify({ orders: await context.prisma.commercialOrder.findMany(), references: await context.prisma.commercialPurchaseReference.findMany(), attempts: await context.prisma.commercialDeliveryAttempt.findMany(), audits: await context.prisma.auditLog.findMany() }, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    expect(persistence).not.toContain(path.created.purchaseReference);
    expect(persistence).not.toContain(rawToken);
    expect(persistence).not.toContain(path.machineFingerprint);
    expect(persistence).not.toContain(downloaded.bytes.toString('utf8'));
  });

  it('preserves early-renewal entitlement and starts expired renewal on the issuance date', async () => {
    const initialPath = await paidOrder({ machine: '7'.repeat(64) });
    const initial = await approve(initialPath.created.publicOrderId);
    await issuance.processApprovedIssuance(initial.id);
    const renewalPath = await paidOrder({ previousLicenceId: initial.licenceId!, machine: '7'.repeat(64) });
    const renewal = await approve(renewalPath.created.publicOrderId);
    const expected = new Date(initial.expiresAt!); expected.setUTCDate(expected.getUTCDate() + 1);
    expect(renewal.startsAt?.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
    await context.prisma.commercialLicenceIssuance.update({ where: { id: initial.id }, data: { startsAt: new Date('2019-01-01T00:00:00.000Z'), expiresAt: new Date('2020-01-01T00:00:00.000Z') } });
    const expiredPath = await paidOrder({ previousLicenceId: initial.licenceId!, machine: '7'.repeat(64), company: 'Expired Renewal Patrols Ltd' });
    const expired = await approve(expiredPath.created.publicOrderId);
    expect(expired.startsAt?.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  });

  it('never permits the staging file key in production configuration', async () => {
    const productionValues: Record<string, string> = { NODE_ENV: 'production', COMMERCIAL_TEST_ISSUER_ENABLED: 'true', COMMERCIAL_TEST_SIGNING_KEY_ID: 'test-phase6-online-key', COMMERCIAL_TEST_SIGNING_PRIVATE_KEY_FILE: join(stagingRoot, 'UNMISTAKABLY-TEST-ONLY-ed25519-private.pem') };
    const disabled = new TestFileEd25519SigningProvider({ get: (key: string) => productionValues[key] } as ConfigService);
    await expect(disabled.sign(Buffer.from('must fail'))).rejects.toMatchObject({ code: 'COMMERCIAL_ISSUER_DISABLED' });
  });
});
