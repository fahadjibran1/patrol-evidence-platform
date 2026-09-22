import { ConfigService } from '@nestjs/config';
import { AdminRole, CommercialDeliveryStatus, CommercialOrderState, CommercialProvider, CommercialProviderMode, CustomerRole, CustomerStatus } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuditService } from '@/audit/audit.service';
import { AuthService } from '@/auth/auth.service';
import { CommercialDeliveryService } from '@/commercial-foundation/commercial-delivery.service';
import { CommercialDeliveryTokenService } from '@/commercial-foundation/commercial-delivery-token.service';
import { CommercialStepUpService } from '@/commercial-foundation/commercial-step-up.service';
import { CommercialOutboxWorkerService } from '@/commercial-foundation/commercial-outbox-worker.service';
import type { CommercialConfigService } from '@/commercial-foundation/commercial-config.service';
import type { CommercialPaymentReconciliationService } from '@/commercial-foundation/commercial-payment-reconciliation.service';
import type { CommercialArtifactStore } from '@/commercial-foundation/commercial-artifact-store.port';
import type { CommercialDeliveryProvider, CommercialDeliveryProviderEvent, SendCommercialLicenceEmailCommand } from '@/commercial-foundation/commercial-delivery-provider.port';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { closeIntegrationContext, createIntegrationContext, resetIntegrationDatabase, type IntegrationContext } from './integration-harness';

class Phase4ArtifactStore implements CommercialArtifactStore {
  values = new Map<string, Buffer>();
  async putImmutable(input: { issuanceId: string; sha256: string; fileName: string; bytes: Buffer }) {
    const storageKey = `${input.issuanceId}/${input.sha256}/${input.fileName}`;
    this.values.set(storageKey, Buffer.from(input.bytes));
    return { storageKey, byteSize: BigInt(input.bytes.length) };
  }
  async readVerified(input: { storageKey: string; sha256: string; byteSize: bigint }) {
    const value = this.values.get(input.storageKey);
    if (!value || BigInt(value.length) !== input.byteSize || createHash('sha256').update(value).digest('hex') !== input.sha256) throw new ApiException(ERROR_CODES.COMMERCIAL_ARTIFACT_INTEGRITY_FAILED, 'integrity failed', 409);
    return Buffer.from(value);
  }
}

class Phase4DeliveryProvider implements CommercialDeliveryProvider {
  readonly name = 'resend' as const;
  sends: SendCommercialLicenceEmailCommand[] = [];
  messages = new Map<string, string>();
  timeoutAfterAcceptOnce = false;
  unavailable = false;
  async send(command: Readonly<SendCommercialLicenceEmailCommand>) {
    this.sends.push({ ...command });
    if (this.unavailable) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_FAILED, 'test provider unavailable', 503);
    const existing = this.messages.get(command.idempotencyKey);
    if (existing) return { messageId: existing, acceptedAt: new Date('2026-09-22T12:00:00.000Z') };
    const messageId = `email_${randomUUID()}`;
    this.messages.set(command.idempotencyKey, messageId);
    if (this.timeoutAfterAcceptOnce) { this.timeoutAfterAcceptOnce = false; throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_FAILED, 'test timeout after accept', 503); }
    return { messageId, acceptedAt: new Date('2026-09-22T12:00:00.000Z') };
  }
  verifyWebhook(rawBody: Buffer, headers: Readonly<Record<string, string | undefined>>): CommercialDeliveryProviderEvent {
    if (headers['test-signature'] !== 'valid') throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_WEBHOOK_INVALID, 'forged test webhook', 400);
    const value = JSON.parse(rawBody.toString('utf8')) as Omit<CommercialDeliveryProviderEvent, 'occurredAt'> & { occurredAt: string };
    return { ...value, occurredAt: new Date(value.occurredAt) };
  }
}

describe('commercial Phase 4 secure licence delivery', () => {
  let context: IntegrationContext;
  let artifacts: Phase4ArtifactStore;
  let provider: Phase4DeliveryProvider;
  let tokens: CommercialDeliveryTokenService;
  let stepUp: CommercialStepUpService;
  let delivery: CommercialDeliveryService;
  let admin: { sub: string; email: string; displayName: string; role: AdminRole };

  beforeAll(async () => { context = await createIntegrationContext(); });
  beforeEach(async () => {
    await resetIntegrationDatabase(context.prisma);
    artifacts = new Phase4ArtifactStore();
    provider = new Phase4DeliveryProvider();
    tokens = new CommercialDeliveryTokenService(new ConfigService({ NODE_ENV: 'test', COMMERCIAL_DELIVERY_TOKEN_SECRET: randomBytes(32).toString('base64'), COMMERCIAL_LICENCE_DOWNLOAD_BASE_URL: 'https://licensing.test/patrolsafe/licence/download' }));
    stepUp = new CommercialStepUpService(context.prisma, context.module.get(AuthService), context.module.get(AuditService));
    delivery = new CommercialDeliveryService(context.prisma, context.module.get(AuditService), tokens, stepUp, artifacts, provider);
    const record = await context.prisma.admin.create({ data: { email: 'operator@phase4.test', displayName: 'Phase 4 Operator', role: AdminRole.SUPER_ADMIN, passwordHash: await bcrypt.hash('Phase4OperatorPass!', 10) } });
    admin = { sub: record.id, email: record.email, displayName: record.displayName, role: record.role };
  });
  afterAll(async () => closeIntegrationContext(context));

  async function seedIssued(suffix = randomUUID(), options: { verified?: boolean } = {}) {
    const email = `owner-${suffix}@phase4.test`;
    const customer = await context.prisma.customer.create({ data: { companyName: `Phase Four Patrols ${suffix}`, contactName: 'Licence Owner', email, status: CustomerStatus.ACTIVE } });
    await context.prisma.customerUser.create({ data: { customerId: customer.id, email, passwordHash: await bcrypt.hash('CustomerPass123!', 4), displayName: 'Licence Owner', role: CustomerRole.OWNER, isActive: true, emailVerifiedAt: options.verified === false ? null : new Date(), notifyLicence: true } });
    const requestHash = createHash('sha256').update(`request-${suffix}`).digest('hex');
    const request = await context.prisma.commercialPurchaseRequest.create({ data: { requestId: randomUUID(), schemaVersion: 2, product: 'Patrol Evidence Platform', plan: 'ANNUAL', installationId: randomUUID(), machineFingerprintEnc: `encrypted-${suffix}`, machineFingerprintHash: createHash('sha256').update(`machine-${suffix}`).digest('hex'), companyName: customer.companyName, appVersion: '1.0.3', buildId: 'phase4-test', clientNonceHash: createHash('sha256').update(`nonce-${suffix}`).digest('hex'), canonicalRequestHash: requestHash, customerId: customer.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    const order = await context.prisma.commercialOrder.create({ data: { publicOrderId: `ord_${randomUUID()}`, purchaseRequestId: request.id, requestHashSnapshot: requestHash, customerId: customer.id, purpose: 'INITIAL', state: CommercialOrderState.ISSUED, product: 'Patrol Evidence Platform', plan: 'ANNUAL', amountMinor: 29900, currency: 'GBP', providerMode: CommercialProviderMode.TEST } });
    await context.prisma.commercialPayment.create({ data: { orderId: order.id, provider: CommercialProvider.STRIPE, providerReference: `pi_${randomUUID()}`, providerMode: CommercialProviderMode.TEST, status: 'SUCCEEDED', amountMinor: 29900, currency: 'GBP', paidAt: new Date() } });
    const issuance = await context.prisma.commercialLicenceIssuance.create({ data: { orderId: order.id, customerId: customer.id, issuanceType: 'INITIAL', status: 'ISSUED', licenceId: `lic-${randomUUID()}`, requestHash, payloadHash: createHash('sha256').update(`payload-${suffix}`).digest('hex'), signingKeyId: 'test-phase4-key', startsAt: new Date('2026-09-22T00:00:00.000Z'), expiresAt: new Date('2027-09-21T00:00:00.000Z'), issuedAt: new Date('2026-09-22T12:00:00.000Z'), featuresSnapshot: { evidence: true }, maxDevices: 1, approvedAt: new Date('2026-09-22T11:00:00.000Z') } });
    const bytes = Buffer.from(JSON.stringify({ payload: { licenceId: issuance.licenceId, product: 'Patrol Evidence Platform' }, signature: 'test-phase4-signature' }));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const stored = await artifacts.putImmutable({ issuanceId: issuance.id, sha256, fileName: `PatrolSafe-Licence-${suffix.slice(0, 8)}.tglic`, bytes });
    const artifact = await context.prisma.commercialLicenceArtifact.create({ data: { artifactId: `art_${sha256.slice(0, 32)}_${suffix.slice(0, 4)}`, issuanceId: issuance.id, status: 'AVAILABLE', fileName: `PatrolSafe-Licence-${suffix.slice(0, 8)}.tglic`, storageKey: stored.storageKey, sha256, byteSize: stored.byteSize, contentType: 'application/json', availableAt: new Date() } });
    const outbox = await context.prisma.commercialOutboxEvent.create({ data: { eventId: randomUUID(), idempotencyKey: `commercial-delivery:${artifact.id}:initial`, aggregateType: 'CommercialLicenceArtifact', aggregateId: artifact.id, eventType: 'commercial.delivery.requested', payload: { artifactId: artifact.id, kind: 'initial' }, correlationId: randomUUID() } });
    return { customer, request, order, issuance, artifact, outbox, bytes, email };
  }

  async function processInitial(seed: Awaited<ReturnType<typeof seedIssued>>) {
    await delivery.processDeliveryOutbox(seed.outbox.id);
    const attempt = await context.prisma.commercialDeliveryAttempt.findFirstOrThrow({ where: { artifactId: seed.artifact.id } });
    return { attempt, raw: tokens.derive(attempt.id).raw };
  }

  it('delivers one immutable artifact through a hashed 24-hour multi-use token', async () => {
    const seed = await seedIssued();
    const { attempt, raw } = await processInitial(seed);
    expect(attempt.tokenHash).toBe(tokens.hash(raw));
    expect(JSON.stringify(attempt)).not.toContain(raw);
    expect(attempt.tokenExpiresAt!.getTime() - attempt.createdAt.getTime()).toBe(24 * 60 * 60_000);
    expect(provider.sends[0]).toEqual(expect.objectContaining({ recipient: seed.email, companyName: seed.customer.companyName }));
    expect(JSON.stringify(provider.sends[0])).not.toContain(seed.request.machineFingerprintEnc);
    await expect(delivery.download(raw)).resolves.toEqual(expect.objectContaining({ bytes: seed.bytes, sha256: seed.artifact.sha256 }));
    await expect(delivery.download(raw)).resolves.toEqual(expect.objectContaining({ bytes: seed.bytes }));
    const downloaded = await context.prisma.commercialDeliveryAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(downloaded.downloadCount).toBe(2);
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { id: seed.order.id } })).state).toBe('DELIVERED');
    expect(await context.prisma.commercialLicenceIssuance.count({ where: { orderId: seed.order.id } })).toBe(1);
    expect(await context.prisma.commercialLicenceArtifact.count({ where: { issuanceId: seed.issuance.id } })).toBe(1);
    const safePersistence = JSON.stringify({ attempts: await context.prisma.commercialDeliveryAttempt.findMany(), audits: await context.prisma.auditLog.findMany({ where: { entityId: attempt.id } }) });
    expect(safePersistence).not.toContain(raw);
    expect(safePersistence).not.toContain(seed.bytes.toString('utf8'));
  });

  it('converges after provider timeout-after-accept without another issuance or artifact', async () => {
    const seed = await seedIssued();
    provider.timeoutAfterAcceptOnce = true;
    await expect(delivery.processDeliveryOutbox(seed.outbox.id)).rejects.toMatchObject({ code: 'COMMERCIAL_DELIVERY_FAILED' });
    await delivery.processDeliveryOutbox(seed.outbox.id);
    expect(provider.sends).toHaveLength(2);
    expect(provider.messages.size).toBe(1);
    expect(await context.prisma.commercialDeliveryAttempt.count()).toBe(1);
    expect(await context.prisma.commercialLicenceIssuance.count()).toBe(1);
    expect(await context.prisma.commercialLicenceArtifact.count()).toBe(1);
  });

  it('uses durable outbox retry after a provider outage', async () => {
    const seed = await seedIssued();
    provider.unavailable = true;
    const worker = new CommercialOutboxWorkerService(context.prisma, { isOutboxWorkerEnabled: () => false } as CommercialConfigService, {} as CommercialPaymentReconciliationService, undefined, delivery);
    expect(await worker.processPending(1)).toEqual({ processed: 0, failed: 1 });
    expect((await context.prisma.commercialOutboxEvent.findUniqueOrThrow({ where: { id: seed.outbox.id } })).status).toBe('FAILED');
    provider.unavailable = false;
    await context.prisma.commercialOutboxEvent.update({ where: { id: seed.outbox.id }, data: { availableAt: new Date(Date.now() - 1) } });
    expect(await worker.processPending(1)).toEqual({ processed: 1, failed: 0 });
    expect(await context.prisma.commercialDeliveryAttempt.count()).toBe(1);
    expect(await context.prisma.commercialLicenceIssuance.count()).toBe(1);
  });

  it('resends the existing artifact idempotently, revokes the old token, and preserves the frozen recipient', async () => {
    const seed = await seedIssued();
    const initial = await processInitial(seed);
    await context.prisma.customer.update({ where: { id: seed.customer.id }, data: { email: 'changed@phase4.test' } });
    const stepUpToken = (await stepUp.create(admin, 'Phase4OperatorPass!')).stepUpToken;
    const idempotencyKey = randomUUID();
    const now = new Date(Date.now() + 6 * 60_000);
    const first = await delivery.queueSupportResend({ publicOrderId: seed.order.publicOrderId, reason: 'Customer lost original email', idempotencyKey, admin, stepUpToken, now });
    const duplicate = await delivery.queueSupportResend({ publicOrderId: seed.order.publicOrderId, reason: 'Duplicate request', idempotencyKey, admin, now });
    expect(duplicate).toEqual(expect.objectContaining({ idempotent: true, requestId: first.requestId }));
    const outbox = await context.prisma.commercialOutboxEvent.findUniqueOrThrow({ where: { eventId: first.requestId } });
    await delivery.processDeliveryOutbox(outbox.id);
    const attempts = await context.prisma.commercialDeliveryAttempt.findMany({ where: { artifactId: seed.artifact.id }, orderBy: { generation: 'asc' } });
    expect(attempts).toHaveLength(2);
    expect(attempts[0].revokedAt).not.toBeNull();
    expect(attempts[1].recipient).toBe(seed.email);
    await expect(delivery.download(initial.raw)).rejects.toMatchObject({ code: 'COMMERCIAL_DELIVERY_TOKEN_EXPIRED' });
    expect(await context.prisma.commercialLicenceIssuance.count()).toBe(1);
    await context.prisma.customerUser.updateMany({ where: { customerId: seed.customer.id }, data: { email: 'new-verified-owner@phase4.test' } });
    const changedRecipientStepUp = (await stepUp.create(admin, 'Phase4OperatorPass!')).stepUpToken;
    const changedRecipientRequest = await delivery.queueSupportResend({ publicOrderId: seed.order.publicOrderId, reason: 'Recipient changed without approval workflow', idempotencyKey: randomUUID(), admin, stepUpToken: changedRecipientStepUp, now: new Date(Date.now() + 12 * 60_000) });
    const changedRecipientOutbox = await context.prisma.commercialOutboxEvent.findUniqueOrThrow({ where: { eventId: changedRecipientRequest.requestId } });
    await expect(delivery.processDeliveryOutbox(changedRecipientOutbox.id)).rejects.toMatchObject({ code: 'COMMERCIAL_DELIVERY_RECIPIENT_UNVERIFIED' });
    expect(provider.sends.every((send) => send.recipient === seed.email)).toBe(true);
  });

  it('rejects tampered, expired, cross-artifact and unverified-recipient delivery paths', async () => {
    const first = await seedIssued();
    const second = await seedIssued();
    const firstToken = await processInitial(first);
    const secondToken = await processInitial(second);
    await expect(delivery.download(`${firstToken.raw.slice(0, -1)}x`)).rejects.toMatchObject({ code: 'COMMERCIAL_DELIVERY_TOKEN_INVALID' });
    await context.prisma.commercialDeliveryAttempt.update({ where: { id: firstToken.attempt.id }, data: { tokenExpiresAt: new Date(Date.now() - 1) } });
    expect(await delivery.status(firstToken.raw)).toEqual({ state: 'Download link expired' });
    await expect(delivery.download(firstToken.raw)).rejects.toMatchObject({ code: 'COMMERCIAL_DELIVERY_TOKEN_EXPIRED' });
    const secondDownload = await delivery.download(secondToken.raw);
    expect(secondDownload.sha256).toBe(second.artifact.sha256);
    expect(secondDownload.sha256).not.toBe(first.artifact.sha256);
    const unverified = await seedIssued(randomUUID(), { verified: false });
    await expect(delivery.processDeliveryOutbox(unverified.outbox.id)).rejects.toMatchObject({ code: 'COMMERCIAL_DELIVERY_RECIPIENT_UNVERIFIED' });
  });

  it('fails closed for missing or hash-mismatched private artifacts', async () => {
    const missing = await seedIssued();
    artifacts.values.delete(missing.artifact.storageKey);
    await expect(delivery.processDeliveryOutbox(missing.outbox.id)).rejects.toMatchObject({ code: 'COMMERCIAL_ARTIFACT_INTEGRITY_FAILED' });
    const tampered = await seedIssued();
    artifacts.values.set(tampered.artifact.storageKey, Buffer.from('tampered'));
    await expect(delivery.processDeliveryOutbox(tampered.outbox.id)).rejects.toMatchObject({ code: 'COMMERCIAL_ARTIFACT_INTEGRITY_FAILED' });
    expect(await context.prisma.auditLog.count({ where: { action: 'commercial.delivery.artifact_integrity_failed' } })).toBe(2);
  });

  it('verifies and deduplicates provider delivery events without changing the licence', async () => {
    const seed = await seedIssued();
    const { attempt } = await processInitial(seed);
    const event: CommercialDeliveryProviderEvent = { eventId: `evt_${randomUUID()}`, messageId: attempt.providerMessageId!, type: 'email.delivered', occurredAt: new Date() };
    const raw = Buffer.from(JSON.stringify(event));
    await expect(delivery.ingestProviderEvent(raw, { 'test-signature': 'forged' })).rejects.toMatchObject({ code: 'COMMERCIAL_DELIVERY_WEBHOOK_INVALID' });
    expect(await context.prisma.commercialDeliveryProviderEvent.count()).toBe(0);
    expect(await delivery.ingestProviderEvent(raw, { 'test-signature': 'valid' })).toEqual({ accepted: true, duplicate: false });
    expect(await delivery.ingestProviderEvent(raw, { 'test-signature': 'valid' })).toEqual({ accepted: true, duplicate: true });
    const conflicting = Buffer.from(JSON.stringify({ ...event, type: 'email.bounced' }));
    await expect(delivery.ingestProviderEvent(conflicting, { 'test-signature': 'valid' })).rejects.toMatchObject({ code: 'COMMERCIAL_DELIVERY_WEBHOOK_INVALID' });
    const outbox = await context.prisma.commercialOutboxEvent.findFirstOrThrow({ where: { eventType: 'commercial.delivery.provider_event.received' } });
    await delivery.processProviderEventOutbox(outbox.id);
    expect((await context.prisma.commercialDeliveryAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe(CommercialDeliveryStatus.DELIVERED);
    expect((await context.prisma.commercialOrder.findUniqueOrThrow({ where: { id: seed.order.id } })).state).toBe(CommercialOrderState.DELIVERED);
    expect(await context.prisma.commercialLicenceIssuance.count()).toBe(1);
    expect(await delivery.status(tokens.derive(attempt.id).raw)).toEqual({ state: 'Delivered' });
  });

  it('fails closed for unauthorised resend and prevents rapid email bombing', async () => {
    const seed = await seedIssued();
    await processInitial(seed);
    await expect(delivery.queueSupportResend({ publicOrderId: seed.order.publicOrderId, reason: 'No authority', idempotencyKey: randomUUID(), admin: { ...admin, role: AdminRole.ADMIN }, stepUpToken: 'x'.repeat(43), now: new Date(Date.now() + 6 * 60_000) })).rejects.toMatchObject({ code: 'COMMERCIAL_OPERATOR_FORBIDDEN' });
    const firstToken = (await stepUp.create(admin, 'Phase4OperatorPass!')).stepUpToken;
    await delivery.queueSupportResend({ publicOrderId: seed.order.publicOrderId, reason: 'Verified support request', idempotencyKey: randomUUID(), admin, stepUpToken: firstToken, now: new Date(Date.now() + 6 * 60_000) });
    const secondToken = (await stepUp.create(admin, 'Phase4OperatorPass!')).stepUpToken;
    await expect(delivery.queueSupportResend({ publicOrderId: seed.order.publicOrderId, reason: 'Too soon', idempotencyKey: randomUUID(), admin, stepUpToken: secondToken, now: new Date(Date.now() + 7 * 60_000) })).rejects.toMatchObject({ code: 'COMMERCIAL_DELIVERY_RESEND_RATE_LIMITED' });
  });

  it('converges concurrent resend submissions with the same idempotency key', async () => {
    const seed = await seedIssued();
    await processInitial(seed);
    const idempotencyKey = randomUUID();
    const now = new Date(Date.now() + 6 * 60_000);
    const [firstStepUp, secondStepUp] = await Promise.all([stepUp.create(admin, 'Phase4OperatorPass!'), stepUp.create(admin, 'Phase4OperatorPass!')]);
    const results = await Promise.all([
      delivery.queueSupportResend({ publicOrderId: seed.order.publicOrderId, reason: 'Concurrent support resend', idempotencyKey, admin, stepUpToken: firstStepUp.stepUpToken, now }),
      delivery.queueSupportResend({ publicOrderId: seed.order.publicOrderId, reason: 'Concurrent support resend', idempotencyKey, admin, stepUpToken: secondStepUp.stepUpToken, now }),
    ]);
    expect(results[0].requestId).toBe(results[1].requestId);
    expect(await context.prisma.commercialOutboxEvent.count({ where: { idempotencyKey: `commercial-delivery:resend:${seed.artifact.id}:${idempotencyKey}` } })).toBe(1);
    expect(await context.prisma.commercialLicenceIssuance.count()).toBe(1);
  });

  it('records bounce and complaint evidence without changing or revoking the issued licence', async () => {
    const seed = await seedIssued();
    const { attempt, raw } = await processInitial(seed);
    for (const type of ['email.bounced', 'email.complained'] as const) {
      const event: CommercialDeliveryProviderEvent = { eventId: `evt_${randomUUID()}`, messageId: attempt.providerMessageId!, type, occurredAt: new Date() };
      await delivery.ingestProviderEvent(Buffer.from(JSON.stringify(event)), { 'test-signature': 'valid' });
      const outbox = await context.prisma.commercialOutboxEvent.findFirstOrThrow({ where: { eventType: 'commercial.delivery.provider_event.received', status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
      await delivery.processProviderEventOutbox(outbox.id);
    }
    const changed = await context.prisma.commercialDeliveryAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(changed.status).toBe(CommercialDeliveryStatus.COMPLAINED);
    expect(changed.revokedAt).not.toBeNull();
    await expect(delivery.download(raw)).rejects.toMatchObject({ code: 'COMMERCIAL_DELIVERY_TOKEN_EXPIRED' });
    expect((await context.prisma.commercialLicenceIssuance.findUniqueOrThrow({ where: { id: seed.issuance.id } })).status).toBe('ISSUED');
    expect(await context.prisma.commercialLicenceArtifact.count()).toBe(1);
  });
});
