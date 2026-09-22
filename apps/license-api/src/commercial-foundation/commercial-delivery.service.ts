import { Inject, Injectable } from '@nestjs/common';
import {
  CommercialActorType,
  CommercialArtifactStatus,
  CommercialDeliveryStatus,
  CommercialIssuanceStatus,
  CommercialOrderState,
  CommercialPaymentStatus,
  CommercialProviderEventStatus,
  OutboxEventStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { COMMERCIAL_ARTIFACT_STORE, type CommercialArtifactStore } from './commercial-artifact-store.port';
import { COMMERCIAL_DELIVERY_PROVIDER, type CommercialDeliveryProvider } from './commercial-delivery-provider.port';
import { CommercialDeliveryTokenService } from './commercial-delivery-token.service';
import { CommercialStepUpService } from './commercial-step-up.service';
import { adminHasCommercialPermission, CommercialOperatorPermission } from './commercial-operator-permissions';
import { createCommercialAudit, createCommercialOutboxEvent } from './commercial-persistence.util';

const ACTIVE_TOKEN_STATUSES = [CommercialDeliveryStatus.PENDING, CommercialDeliveryStatus.QUEUED, CommercialDeliveryStatus.SENT, CommercialDeliveryStatus.DELIVERED, CommercialDeliveryStatus.BOUNCED, CommercialDeliveryStatus.FAILED];
const DELIVERABLE_ORDER_STATES = new Set<CommercialOrderState>([CommercialOrderState.ISSUED, CommercialOrderState.DELIVERY_PENDING, CommercialOrderState.DELIVERED]);

@Injectable()
export class CommercialDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: CommercialDeliveryTokenService,
    private readonly stepUp: CommercialStepUpService,
    @Inject(COMMERCIAL_ARTIFACT_STORE) private readonly artifacts: CommercialArtifactStore,
    @Inject(COMMERCIAL_DELIVERY_PROVIDER) private readonly provider: CommercialDeliveryProvider,
  ) {}

  async queueSupportResend(input: { publicOrderId: string; reason: string; idempotencyKey: string; admin: AuthenticatedAdmin; stepUpToken?: string; correlationId?: string; now?: Date }) {
    if (!adminHasCommercialPermission(input.admin.role, CommercialOperatorPermission.RESEND_LICENCE)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_OPERATOR_FORBIDDEN, 'Commercial delivery permission is required.', 403);
    }
    if (!/^[0-9a-f-]{36}$/i.test(input.idempotencyKey)) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_NOT_ALLOWED, 'A valid idempotency key is required.', 400);
    const correlationId = input.correlationId ?? randomUUID();
    const now = input.now ?? new Date();
    const order = await this.prisma.commercialOrder.findUnique({ where: { publicOrderId: input.publicOrderId }, include: { issuance: { include: { artifacts: true } } } });
    const artifact = order?.issuance?.artifacts[0];
    if (!order || !artifact) throw new ApiException(ERROR_CODES.COMMERCIAL_ORDER_NOT_FOUND, 'Commercial licence delivery was not found.', 404);
    const outboxKey = `commercial-delivery:resend:${artifact.id}:${input.idempotencyKey}`;
    const existing = await this.prisma.commercialOutboxEvent.findUnique({ where: { idempotencyKey: outboxKey } });
    if (existing) return { queued: true, idempotent: true, requestId: existing.eventId };
    try {
      return await this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.commercialOutboxEvent.findUnique({ where: { idempotencyKey: outboxKey } });
      if (duplicate) return { queued: true, idempotent: true, requestId: duplicate.eventId };
      await this.stepUp.consume(tx, input.admin, input.stepUpToken, correlationId);
      const current = await tx.commercialLicenceArtifact.findUnique({ where: { id: artifact.id }, include: { issuance: { include: { order: true } } } });
      if (!current || current.status !== CommercialArtifactStatus.AVAILABLE || current.issuance.status !== CommercialIssuanceStatus.ISSUED || current.issuance.order.holdReason || current.issuance.order.refundedAt) {
        throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_NOT_ALLOWED, 'This licence is not eligible for delivery.', 409);
      }
      if (current.lastDeliveryQueuedAt && now.getTime() - current.lastDeliveryQueuedAt.getTime() < 5 * 60_000) {
        throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_RESEND_RATE_LIMITED, 'A licence link was sent recently. Try again later.', 429);
      }
      await tx.commercialLicenceArtifact.update({ where: { id: current.id }, data: { lastDeliveryQueuedAt: now } });
      await createCommercialOutboxEvent(tx, { idempotencyKey: outboxKey, aggregateType: 'CommercialLicenceArtifact', aggregateId: current.id, eventType: 'commercial.delivery.requested', correlationId, payload: { artifactId: current.id, kind: 'support_resend' } });
      await createCommercialAudit(tx, this.audit, { actorType: CommercialActorType.OPERATOR, actorAdminId: input.admin.sub, action: 'commercial.delivery.resend_requested', entityType: 'CommercialLicenceArtifact', entityId: current.id, customerId: current.issuance.customerId, correlationId, metadata: { publicOrderId: input.publicOrderId, reason: input.reason.trim() } });
      const queued = await tx.commercialOutboxEvent.findUniqueOrThrow({ where: { idempotencyKey: outboxKey } });
      return { queued: true, idempotent: false, requestId: queued.eventId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
        const converged = await this.prisma.commercialOutboxEvent.findUnique({ where: { idempotencyKey: outboxKey } });
        if (converged) return { queued: true, idempotent: true, requestId: converged.eventId };
      }
      throw error;
    }
  }

  async processDeliveryOutbox(outboxId: string): Promise<{ outcome: string; attemptId?: string }> {
    const outbox = await this.prisma.commercialOutboxEvent.findUnique({ where: { id: outboxId } });
    if (!outbox || outbox.eventType !== 'commercial.delivery.requested') throw new ApiException(ERROR_CODES.COMMERCIAL_OUTBOX_INVALID, 'Delivery outbox event was not found.', 404);
    if (outbox.status === OutboxEventStatus.PUBLISHED) return { outcome: 'already_processed' };
    const context = await this.loadEligibleArtifact(outbox.aggregateId);
    await this.verifyArtifact(context.artifact, context.customerId, outbox.correlationId);
    const recipient = await this.authoritativeRecipient(context);
    const attempt = await this.getOrCreateAttempt({ outbox, context, recipient });
    const token = this.tokens.derive(attempt.id);
    if (token.hash !== attempt.tokenHash) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_TOKEN_INVALID, 'Licence delivery token identity is invalid.', 409);
    if (!attempt.tokenExpiresAt || attempt.tokenExpiresAt <= new Date()) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_TOKEN_EXPIRED, 'Licence delivery link has expired.', 410);
    const command = {
      attemptId: attempt.id,
      idempotencyKey: attempt.idempotencyKey,
      recipient: attempt.recipient,
      companyName: context.companyName,
      startsAt: this.date(context.startsAt),
      expiresAt: this.date(context.expiresAt),
      downloadUrl: this.tokens.downloadUrl(token.raw),
      linkExpiresAt: attempt.tokenExpiresAt.toISOString(),
    };
    await this.audit.record({ actorType: CommercialActorType.SYSTEM, action: 'commercial.delivery.provider_send_attempted', entityType: 'CommercialDeliveryAttempt', entityId: attempt.id, customerId: context.customerId, correlationId: outbox.correlationId, metadata: { provider: this.provider.name, artifactId: context.artifact.artifactId } });
    try {
      const accepted = await this.provider.send(command);
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.commercialDeliveryAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
        if (current.providerMessageId && current.providerMessageId !== accepted.messageId) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_FAILED, 'Delivery provider identity changed.', 409);
        await tx.commercialDeliveryAttempt.update({ where: { id: current.id }, data: { status: CommercialDeliveryStatus.SENT, providerMessageId: accepted.messageId, sentAt: current.sentAt ?? accepted.acceptedAt, attempts: { increment: 1 }, lastError: null } });
        await tx.commercialOrder.updateMany({ where: { id: context.orderId, state: CommercialOrderState.ISSUED }, data: { state: CommercialOrderState.DELIVERY_PENDING, stateVersion: { increment: 1 } } });
        await tx.commercialOutboxEvent.update({ where: { id: outbox.id }, data: { status: OutboxEventStatus.PUBLISHED, publishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null } });
        await createCommercialAudit(tx, this.audit, { actorType: CommercialActorType.PROVIDER, actorId: 'resend', action: 'commercial.delivery.provider_accepted', entityType: 'CommercialDeliveryAttempt', entityId: current.id, customerId: context.customerId, correlationId: outbox.correlationId, metadata: { providerMessageId: accepted.messageId, artifactId: context.artifact.artifactId } });
        if (outbox.idempotencyKey.startsWith('commercial-delivery:resend:')) await createCommercialAudit(tx, this.audit, { actorType: CommercialActorType.SYSTEM, action: 'commercial.delivery.resend_completed', entityType: 'CommercialDeliveryAttempt', entityId: current.id, customerId: context.customerId, correlationId: outbox.correlationId, metadata: { artifactId: context.artifact.artifactId } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { outcome: 'email_sent', attemptId: attempt.id };
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await tx.commercialDeliveryAttempt.updateMany({ where: { id: attempt.id, providerMessageId: null }, data: { status: CommercialDeliveryStatus.FAILED, attempts: { increment: 1 }, lastError: this.safeCode(error) } });
        await createCommercialAudit(tx, this.audit, { actorType: CommercialActorType.SYSTEM, action: 'commercial.delivery.send_failed', entityType: 'CommercialDeliveryAttempt', entityId: attempt.id, customerId: context.customerId, correlationId: outbox.correlationId, metadata: { failureCode: this.safeCode(error) } });
      }).catch(() => undefined);
      throw error;
    }
  }

  async ingestProviderEvent(rawBody: Buffer, headers: Readonly<Record<string, string | undefined>>, correlationId = randomUUID()) {
    const verified = this.provider.verifyWebhook(rawBody, headers);
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const event = await tx.commercialDeliveryProviderEvent.create({ data: { providerEventId: verified.eventId, providerMessageId: verified.messageId, eventType: verified.type, payloadHash, correlationId, safeMetadata: { occurredAt: verified.occurredAt.toISOString() } } });
        await createCommercialOutboxEvent(tx, { idempotencyKey: `commercial-delivery-provider:${verified.eventId}`, aggregateType: 'CommercialDeliveryProviderEvent', aggregateId: event.id, eventType: 'commercial.delivery.provider_event.received', correlationId, payload: { providerEventId: event.id } });
        await createCommercialAudit(tx, this.audit, { actorType: CommercialActorType.PROVIDER, actorId: 'resend', action: 'commercial.delivery.provider_event_received', entityType: 'CommercialDeliveryProviderEvent', entityId: event.id, correlationId, metadata: { providerEventId: verified.eventId, eventType: verified.type, providerMessageId: verified.messageId } });
        return { accepted: true, duplicate: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.commercialDeliveryProviderEvent.findUnique({ where: { providerEventId: verified.eventId } });
        if (existing?.payloadHash === payloadHash && existing.providerMessageId === verified.messageId && existing.eventType === verified.type) return { accepted: true, duplicate: true };
        throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_WEBHOOK_INVALID, 'Delivery provider event identity conflict.', 409);
      }
      throw error;
    }
  }

  async processProviderEventOutbox(outboxId: string) {
    const outbox = await this.prisma.commercialOutboxEvent.findUnique({ where: { id: outboxId } });
    if (!outbox || outbox.eventType !== 'commercial.delivery.provider_event.received') throw new ApiException(ERROR_CODES.COMMERCIAL_OUTBOX_INVALID, 'Delivery provider event was not found.', 404);
    if (outbox.status === OutboxEventStatus.PUBLISHED) return { outcome: 'already_processed' };
    const event = await this.prisma.commercialDeliveryProviderEvent.findUniqueOrThrow({ where: { id: outbox.aggregateId } });
    const attempt = event.providerMessageId ? await this.prisma.commercialDeliveryAttempt.findUnique({ where: { providerMessageId: event.providerMessageId }, include: { artifact: { include: { issuance: { include: { order: true } } } } } }) : null;
    await this.prisma.$transaction(async (tx) => {
      if (!attempt) {
        await tx.commercialDeliveryProviderEvent.update({ where: { id: event.id }, data: { status: CommercialProviderEventStatus.IGNORED, processedAt: new Date(), lastError: 'unknown_message' } });
      } else {
        const change = this.providerEventChange(event.eventType, new Date());
        await tx.commercialDeliveryAttempt.update({ where: { id: attempt.id }, data: change.attempt });
        if (change.delivered) await tx.commercialOrder.update({ where: { id: attempt.artifact.issuance.order.id }, data: { state: CommercialOrderState.DELIVERED, stateVersion: { increment: 1 } } });
        await tx.commercialDeliveryProviderEvent.update({ where: { id: event.id }, data: { status: CommercialProviderEventStatus.PROCESSED, processedAt: new Date(), lastError: null } });
        await createCommercialAudit(tx, this.audit, { actorType: CommercialActorType.PROVIDER, actorId: 'resend', action: change.auditAction, entityType: 'CommercialDeliveryAttempt', entityId: attempt.id, customerId: attempt.customerId, correlationId: event.correlationId, metadata: { providerEventId: event.providerEventId, providerMessageId: event.providerMessageId } });
      }
      await tx.commercialOutboxEvent.update({ where: { id: outbox.id }, data: { status: OutboxEventStatus.PUBLISHED, publishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { outcome: attempt ? event.eventType : 'ignored_unknown_message' };
  }

  async download(rawToken: string, metadata?: { ipAddress?: string; userAgent?: string }, now = new Date()) {
    const attempt = await this.resolveToken(rawToken, now);
    const bytes = await this.verifyArtifact(attempt.artifact, attempt.customerId, attempt.id);
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.commercialDeliveryAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      if (current.revokedAt || !current.tokenExpiresAt || current.tokenExpiresAt <= now) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_TOKEN_EXPIRED, 'Licence delivery link has expired.', 410);
      await tx.commercialDeliveryAttempt.update({ where: { id: current.id }, data: { status: CommercialDeliveryStatus.DELIVERED, firstDownloadedAt: current.firstDownloadedAt ?? now, lastDownloadedAt: now, downloadCount: { increment: 1 } } });
      await tx.commercialOrder.update({ where: { id: attempt.artifact.issuance.order.id }, data: { state: CommercialOrderState.DELIVERED, stateVersion: { increment: 1 } } });
      await createCommercialAudit(tx, this.audit, { actorType: CommercialActorType.CUSTOMER, action: 'commercial.delivery.licence_downloaded', entityType: 'CommercialDeliveryAttempt', entityId: current.id, customerId: current.customerId, correlationId: randomUUID(), ipAddress: metadata?.ipAddress, userAgent: metadata?.userAgent, metadata: { artifactId: attempt.artifact.artifactId, downloadCount: current.downloadCount + 1 } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { bytes, fileName: attempt.artifact.fileName, contentType: attempt.artifact.contentType, sha256: attempt.artifact.sha256 };
  }

  async status(rawToken: string, now = new Date()) {
    const hash = this.validTokenHash(rawToken);
    const attempt = await this.prisma.commercialDeliveryAttempt.findUnique({ where: { tokenHash: hash } });
    if (!attempt) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_TOKEN_INVALID, 'Licence delivery link is not valid.', 404);
    if (attempt.revokedAt) return { state: 'Support required' };
    if (!attempt.tokenExpiresAt || attempt.tokenExpiresAt <= now) return { state: 'Download link expired' };
    if (attempt.complainedAt || attempt.status === CommercialDeliveryStatus.FAILED || attempt.status === CommercialDeliveryStatus.BOUNCED) return { state: 'Delivery problem' };
    if (attempt.firstDownloadedAt) return { state: 'Delivered' };
    if (attempt.deliveredAt) return { state: 'Delivered' };
    if (attempt.sentAt) return { state: 'Email sent' };
    return { state: 'Licence ready' };
  }

  private async getOrCreateAttempt(input: { outbox: { idempotencyKey: string; aggregateId: string; correlationId: string }; context: Awaited<ReturnType<CommercialDeliveryService['loadEligibleArtifact']>>; recipient: string }) {
    const existing = await this.prisma.commercialDeliveryAttempt.findUnique({ where: { requestKey: input.outbox.idempotencyKey } });
    if (existing) return existing;
    const attemptId = randomUUID();
    const createdAt = new Date();
    const token = this.tokens.derive(attemptId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const artifact = await tx.commercialLicenceArtifact.findUniqueOrThrow({ where: { id: input.context.artifact.id } });
        const generation = artifact.deliveryGeneration + 1;
        const changed = await tx.commercialLicenceArtifact.updateMany({ where: { id: artifact.id, deliveryGeneration: artifact.deliveryGeneration }, data: { deliveryGeneration: generation, deliveryRecipient: artifact.deliveryRecipient ?? input.recipient, lastDeliveryQueuedAt: createdAt } });
        if (changed.count !== 1) throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_CONFLICT, 'Delivery changed concurrently.', 409);
        const revoked = await tx.commercialDeliveryAttempt.updateMany({ where: { artifactId: artifact.id, revokedAt: null, status: { in: ACTIVE_TOKEN_STATUSES } }, data: { status: CommercialDeliveryStatus.REVOKED, revokedAt: createdAt } });
        const attempt = await tx.commercialDeliveryAttempt.create({ data: { id: attemptId, artifactId: artifact.id, customerId: input.context.customerId, idempotencyKey: `resend:${artifact.artifactId}:${generation}`, requestKey: input.outbox.idempotencyKey, generation, status: CommercialDeliveryStatus.QUEUED, channel: 'EMAIL_LINK', provider: this.provider.name, recipient: input.recipient, tokenPurpose: CommercialDeliveryTokenService.PURPOSE, tokenHash: token.hash, tokenExpiresAt: this.tokens.expiresAt(createdAt), createdAt } });
        await tx.commercialOrder.updateMany({ where: { id: input.context.orderId, state: CommercialOrderState.ISSUED }, data: { state: CommercialOrderState.DELIVERY_PENDING, stateVersion: { increment: 1 } } });
        await createCommercialAudit(tx, this.audit, { actorType: CommercialActorType.SYSTEM, action: 'commercial.delivery.token_minted', entityType: 'CommercialDeliveryAttempt', entityId: attempt.id, customerId: input.context.customerId, correlationId: input.outbox.correlationId, metadata: { artifactId: artifact.artifactId, generation, expiresAt: attempt.tokenExpiresAt?.toISOString(), purpose: attempt.tokenPurpose } });
        if (revoked.count > 0) await createCommercialAudit(tx, this.audit, { actorType: CommercialActorType.SYSTEM, action: 'commercial.delivery.token_revoked', entityType: 'CommercialLicenceArtifact', entityId: artifact.id, customerId: input.context.customerId, correlationId: input.outbox.correlationId, metadata: { artifactId: artifact.artifactId, count: revoked.count, reason: 'replacement_delivery_token' } });
        await createCommercialAudit(tx, this.audit, { actorType: CommercialActorType.SYSTEM, action: 'commercial.delivery.queued', entityType: 'CommercialDeliveryAttempt', entityId: attempt.id, customerId: input.context.customerId, correlationId: input.outbox.correlationId, metadata: { artifactId: artifact.artifactId, provider: this.provider.name } });
        return attempt;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.prisma.commercialDeliveryAttempt.findUniqueOrThrow({ where: { requestKey: input.outbox.idempotencyKey } });
      throw error;
    }
  }

  private async loadEligibleArtifact(artifactId: string) {
    const artifact = await this.prisma.commercialLicenceArtifact.findUnique({ where: { id: artifactId }, include: { issuance: { include: { order: { include: { payments: true, customer: { include: { users: true } } } } } } } });
    const issuance = artifact?.issuance;
    const order = issuance?.order;
    const customer = order?.customer;
    const paid = order?.payments.some((payment) => payment.status === CommercialPaymentStatus.SUCCEEDED && payment.amountMinor === 29900 && payment.currency === 'GBP');
    if (!artifact || artifact.status !== CommercialArtifactStatus.AVAILABLE || artifact.contentType !== 'application/json' || !/^[A-Za-z0-9._-]+\.tglic$/.test(artifact.fileName) || !/^[a-f0-9]{64}$/.test(artifact.sha256) || artifact.byteSize <= 0n || !issuance || issuance.status !== CommercialIssuanceStatus.ISSUED || issuance.commercialReviewRequired || !order || !customer || issuance.customerId !== customer.id || artifact.issuanceId !== issuance.id || !paid || order.refundedAt || order.cancelledAt || order.holdReason || !DELIVERABLE_ORDER_STATES.has(order.state)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_NOT_ALLOWED, 'This licence is not eligible for delivery.', 409);
    }
    if (!issuance.startsAt || !issuance.expiresAt) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_NOT_ALLOWED, 'Licence dates are unavailable.', 409);
    return { artifact, issuance, orderId: order.id, customerId: customer.id, customer, companyName: customer.companyName, startsAt: issuance.startsAt, expiresAt: issuance.expiresAt };
  }

  private async authoritativeRecipient(context: Awaited<ReturnType<CommercialDeliveryService['loadEligibleArtifact']>>) {
    const frozen = context.artifact.deliveryRecipient?.trim().toLowerCase();
    const candidates = context.customer.users.filter((user) => user.isActive && user.emailVerifiedAt && user.notifyLicence && (user.role === 'OWNER' || user.role === 'ADMINISTRATOR'));
    const selected = frozen ? candidates.find((user) => user.email.toLowerCase() === frozen) : candidates.find((user) => user.email.toLowerCase() === context.customer.email.toLowerCase()) ?? candidates[0];
    if (!selected || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(selected.email)) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_RECIPIENT_UNVERIFIED, 'A verified licence recipient is required.', 409);
    return selected.email.toLowerCase();
  }

  private async resolveToken(rawToken: string, now: Date) {
    const hash = this.validTokenHash(rawToken);
    const attempt = await this.prisma.commercialDeliveryAttempt.findUnique({ where: { tokenHash: hash }, include: { artifact: { include: { issuance: { include: { order: true } } } } } });
    if (!attempt || attempt.tokenPurpose !== CommercialDeliveryTokenService.PURPOSE) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_TOKEN_INVALID, 'Licence delivery link is not valid.', 404);
    if (attempt.revokedAt || !attempt.tokenExpiresAt || attempt.tokenExpiresAt <= now) {
      await this.prisma.commercialDeliveryAttempt.updateMany({ where: { id: attempt.id, revokedAt: null }, data: { status: CommercialDeliveryStatus.EXPIRED } }).catch(() => undefined);
      await this.audit.record({ actorType: CommercialActorType.CUSTOMER, action: 'commercial.delivery.token_expired', entityType: 'CommercialDeliveryAttempt', entityId: attempt.id, customerId: attempt.customerId, correlationId: randomUUID(), metadata: {} }).catch(() => undefined);
      throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_TOKEN_EXPIRED, 'Licence delivery link has expired.', 410);
    }
    return attempt;
  }

  private validTokenHash(rawToken: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) throw new ApiException(ERROR_CODES.COMMERCIAL_DELIVERY_TOKEN_INVALID, 'Licence delivery link is not valid.', 404);
    return this.tokens.hash(rawToken);
  }

  private async verifyArtifact(artifact: { id: string; artifactId: string; storageKey: string; sha256: string; byteSize: bigint }, customerId: string, correlationId: string) {
    try { return await this.artifacts.readVerified({ storageKey: artifact.storageKey, sha256: artifact.sha256, byteSize: artifact.byteSize }); }
    catch (error) {
      await this.audit.record({ actorType: CommercialActorType.SYSTEM, action: 'commercial.delivery.artifact_integrity_failed', entityType: 'CommercialLicenceArtifact', entityId: artifact.id, customerId, correlationId, metadata: { artifactId: artifact.artifactId, failureCode: this.safeCode(error) } }).catch(() => undefined);
      throw error;
    }
  }

  private providerEventChange(type: string, now: Date): { attempt: Prisma.CommercialDeliveryAttemptUpdateInput; delivered: boolean; auditAction: string } {
    if (type === 'email.delivered') return { attempt: { status: CommercialDeliveryStatus.DELIVERED, deliveredAt: now }, delivered: true, auditAction: 'commercial.delivery.provider_delivered' };
    if (type === 'email.bounced') return { attempt: { status: CommercialDeliveryStatus.BOUNCED, bouncedAt: now }, delivered: false, auditAction: 'commercial.delivery.provider_bounced' };
    if (type === 'email.complained') return { attempt: { status: CommercialDeliveryStatus.COMPLAINED, complainedAt: now, revokedAt: now }, delivered: false, auditAction: 'commercial.delivery.provider_complained' };
    if (type === 'email.failed') return { attempt: { status: CommercialDeliveryStatus.FAILED, lastError: 'provider_delivery_failed' }, delivered: false, auditAction: 'commercial.delivery.provider_failed' };
    return { attempt: { status: CommercialDeliveryStatus.SENT, sentAt: now }, delivered: false, auditAction: 'commercial.delivery.provider_sent' };
  }

  private safeCode(error: unknown) { return error instanceof ApiException ? error.code : 'COMMERCIAL_DELIVERY_FAILED'; }
  private date(value: Date) { return value.toISOString().slice(0, 10); }
}
