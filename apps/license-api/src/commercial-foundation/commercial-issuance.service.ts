import { Inject, Injectable } from '@nestjs/common';
import { CommercialActorType, CommercialArtifactStatus, CommercialIssuanceStatus, CommercialIssuanceType, CommercialOrderState, Prisma } from '@prisma/client';
import { ALL_LICENCE_FEATURES } from '@patrol/license-core';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { EncryptionService } from '@/crypto/encryption.service';
import { AuditService } from '@/audit/audit.service';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { COMMERCIAL_LICENCE_ISSUER, type CommercialLicenceIssuer, type IssueCommercialLicenceCommand } from './commercial-issuer.port';
import { createCommercialAudit, createCommercialOutboxEvent } from './commercial-persistence.util';
import { CommercialStepUpService } from './commercial-step-up.service';
import { CommercialApprovalPreconditionsService } from './commercial-approval-preconditions.service';
import { adminHasCommercialPermission, CommercialOperatorPermission } from './commercial-operator-permissions';

@Injectable()
export class CommercialIssuanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly auditService: AuditService,
    private readonly stepUp: CommercialStepUpService,
    private readonly preconditions: CommercialApprovalPreconditionsService,
    @Inject(COMMERCIAL_LICENCE_ISSUER) private readonly issuer: CommercialLicenceIssuer,
  ) {}

  async listApprovalQueue(admin: AuthenticatedAdmin) {
    this.assertPermission(admin, CommercialOperatorPermission.VIEW_APPROVAL_QUEUE);
    const orders = await this.prisma.commercialOrder.findMany({
      where: { state: { in: [CommercialOrderState.PAID_AWAITING_APPROVAL, CommercialOrderState.HELD] } },
      include: { purchaseRequest: true, customer: true, payments: { orderBy: { createdAt: 'desc' }, take: 1 }, issuance: true },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });
    return orders.map((order) => this.safeReview(order));
  }

  async getApproval(publicOrderId: string, admin: AuthenticatedAdmin, correlationId = randomUUID()) {
    this.assertPermission(admin, CommercialOperatorPermission.VIEW_APPROVAL_QUEUE);
    const order = await this.prisma.commercialOrder.findUnique({
      where: { publicOrderId },
      include: { purchaseRequest: true, customer: true, payments: { orderBy: { createdAt: 'desc' } }, issuance: true },
    });
    if (!order) throw new ApiException(ERROR_CODES.COMMERCIAL_ORDER_NOT_FOUND, 'Commercial order was not found.', 404);
    await this.auditService.record({ actorType: CommercialActorType.OPERATOR, actorAdminId: admin.sub, action: 'commercial.approval.viewed', entityType: 'CommercialOrder', entityId: order.id, customerId: order.customerId, correlationId, metadata: { publicOrderId } });
    return this.safeReview(order);
  }

  async approve(input: { publicOrderId: string; admin: AuthenticatedAdmin; stepUpToken?: string; correlationId?: string }) {
    this.assertPermission(input.admin, CommercialOperatorPermission.APPROVE_ISSUANCE);
    const correlationId = input.correlationId ?? randomUUID();
    let verified;
    try {
      verified = await this.preconditions.assertPaidAndEligible(input.publicOrderId);
    } catch (error) {
      const order = await this.prisma.commercialOrder.findUnique({
        where: { publicOrderId: input.publicOrderId },
        select: { id: true, customerId: true },
      }).catch(() => null);
      if (order) {
        await this.auditDenied(order.id, order.customerId, input.admin, correlationId, this.safeCode(error)).catch(() => undefined);
      }
      throw error;
    }
    if (verified.issuance) return verified.issuance;
    const policy = await this.licenceWindow(verified.purchaseRequest.previousLicenceId, new Date());
    const issuedAt = new Date();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.stepUp.consume(tx, input.admin, input.stepUpToken, correlationId);
        const order = await tx.commercialOrder.findUniqueOrThrow({ where: { id: verified.id }, include: { purchaseRequest: true, payments: true, issuance: true, customer: true } });
        if (order.issuance) return order.issuance;
        this.assertTransactionalApprovalState(order);
        const changed = await tx.commercialOrder.updateMany({
          where: { id: order.id, state: CommercialOrderState.PAID_AWAITING_APPROVAL, stateVersion: order.stateVersion, holdReason: null, refundedAt: null },
          data: { state: CommercialOrderState.ISSUANCE_PENDING, stateVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_CONFLICT, 'Commercial order changed concurrently.', 409);
        const issuance = await tx.commercialLicenceIssuance.create({
          data: {
            orderId: order.id,
            customerId: order.customerId!,
            issuanceType: order.purpose === 'INITIAL' ? CommercialIssuanceType.INITIAL : order.purpose === 'RENEWAL' ? CommercialIssuanceType.RENEWAL : CommercialIssuanceType.REISSUE,
            status: CommercialIssuanceStatus.APPROVED,
            licenceId: `lic-${randomUUID()}`,
            predecessorLicenceId: order.purchaseRequest.previousLicenceId,
            requestHash: order.purchaseRequest.canonicalRequestHash,
            startsAt: policy.startsAt,
            expiresAt: policy.expiresAt,
            issuedAt,
            featuresSnapshot: { ...ALL_LICENCE_FEATURES },
            maxDevices: 1,
            approvedByAdminId: input.admin.sub,
            approvedAt: issuedAt,
            deliveryRecipient: order.customer!.email.trim().toLowerCase(),
          },
        });
        await createCommercialAudit(tx, this.auditService, { actorType: CommercialActorType.OPERATOR, actorAdminId: input.admin.sub, action: 'commercial.approval.succeeded', entityType: 'CommercialLicenceIssuance', entityId: issuance.id, customerId: order.customerId, correlationId, metadata: { publicOrderId: order.publicOrderId, issuanceType: issuance.issuanceType, startsAt: this.date(policy.startsAt), expiresAt: this.date(policy.expiresAt), deliveryRecipientApproved: true } });
        await createCommercialAudit(tx, this.auditService, { actorType: CommercialActorType.OPERATOR, actorAdminId: input.admin.sub, action: 'commercial.issuance.queued', entityType: 'CommercialLicenceIssuance', entityId: issuance.id, customerId: order.customerId, correlationId, metadata: { publicOrderId: order.publicOrderId } });
        await createCommercialOutboxEvent(tx, { idempotencyKey: `commercial-issuance:${issuance.id}:requested`, aggregateType: 'CommercialLicenceIssuance', aggregateId: issuance.id, eventType: 'commercial.issuance.requested', correlationId, payload: { issuanceId: issuance.id, publicOrderId: order.publicOrderId } });
        return issuance;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.commercialLicenceIssuance.findUnique({ where: { orderId: verified.id } });
        if (existing) return existing;
      }
      await this.auditDenied(verified.id, verified.customerId, input.admin, correlationId, this.safeCode(error));
      throw error;
    }
  }

  async hold(publicOrderId: string, reason: string, admin: AuthenticatedAdmin, stepUpToken?: string, correlationId = randomUUID()) {
    return this.decide(publicOrderId, reason, admin, stepUpToken, CommercialOrderState.HELD, CommercialOperatorPermission.HOLD_ORDER, 'commercial.approval.held', correlationId);
  }

  async reject(publicOrderId: string, reason: string, admin: AuthenticatedAdmin, stepUpToken?: string, correlationId = randomUUID()) {
    return this.decide(publicOrderId, reason, admin, stepUpToken, CommercialOrderState.REJECTED, CommercialOperatorPermission.REJECT_ORDER, 'commercial.approval.rejected', correlationId);
  }

  async releaseHold(publicOrderId: string, reason: string, admin: AuthenticatedAdmin, stepUpToken?: string, correlationId = randomUUID()) {
    this.assertPermission(admin, CommercialOperatorPermission.RELEASE_HOLD);
    return this.prisma.$transaction(async (tx) => {
      await this.stepUp.consume(tx, admin, stepUpToken, correlationId);
      const order = await tx.commercialOrder.findUnique({ where: { publicOrderId } });
      if (!order) throw new ApiException(ERROR_CODES.COMMERCIAL_ORDER_NOT_FOUND, 'Commercial order was not found.', 404);
      if (order.state !== CommercialOrderState.HELD || order.heldFromState !== CommercialOrderState.PAID_AWAITING_APPROVAL) throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_INVALID, 'Only a paid approval hold can be released.', 409);
      const updated = await tx.commercialOrder.update({ where: { id: order.id }, data: { state: CommercialOrderState.PAID_AWAITING_APPROVAL, heldFromState: null, holdReason: null, stateVersion: { increment: 1 } } });
      await createCommercialAudit(tx, this.auditService, { actorType: CommercialActorType.OPERATOR, actorAdminId: admin.sub, action: 'commercial.approval.hold_released', entityType: 'CommercialOrder', entityId: order.id, customerId: order.customerId, correlationId, metadata: { reason: reason.trim() } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async processApprovedIssuance(issuanceId: string, correlationId: string = randomUUID()) {
    const snapshot = await this.prisma.commercialLicenceIssuance.findUnique({ where: { id: issuanceId }, include: { order: { include: { purchaseRequest: true, payments: true } }, artifacts: true } });
    if (!snapshot) throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUANCE_NOT_ALLOWED, 'Approved issuance was not found.', 404);
    if (snapshot.status === CommercialIssuanceStatus.ISSUED && snapshot.artifacts[0]) {
      await this.auditService.record({ actorType: CommercialActorType.SYSTEM, action: 'commercial.issuance.retry_converged', entityType: 'CommercialLicenceIssuance', entityId: snapshot.id, customerId: snapshot.customerId, correlationId, metadata: { artifactId: snapshot.artifacts[0].artifactId } });
      return { issuance: snapshot, artifact: snapshot.artifacts[0], idempotent: true };
    }
    try {
      await this.preconditions.assertPaidAndEligible(snapshot.order.publicOrderId);
    } catch (error) {
      await this.auditService.record({
        actorType: CommercialActorType.SYSTEM,
        action: 'commercial.issuance.blocked',
        entityType: 'CommercialLicenceIssuance',
        entityId: snapshot.id,
        customerId: snapshot.customerId,
        correlationId,
        metadata: { reason: this.safeCode(error) },
      }).catch(() => undefined);
      throw error;
    }
    if (snapshot.order.state !== CommercialOrderState.ISSUANCE_PENDING || !snapshot.licenceId || !snapshot.issuedAt || !snapshot.startsAt || !snapshot.expiresAt || snapshot.maxDevices !== 1) throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUANCE_NOT_ALLOWED, 'Issuance snapshot is incomplete or no longer eligible.', 409);
    const claimed = await this.prisma.commercialLicenceIssuance.updateMany({ where: { id: snapshot.id, status: { in: [CommercialIssuanceStatus.APPROVED, CommercialIssuanceStatus.FAILED] }, commercialReviewRequired: false }, data: { status: CommercialIssuanceStatus.PROCESSING, failureCode: null } });
    if (claimed.count !== 1) throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_CONFLICT, 'Issuance is already being processed.', 409);
    await this.auditService.record({ actorType: CommercialActorType.SYSTEM, action: 'commercial.issuance.started', entityType: 'CommercialLicenceIssuance', entityId: snapshot.id, customerId: snapshot.customerId, correlationId, metadata: { publicOrderId: snapshot.order.publicOrderId } });
    const command: IssueCommercialLicenceCommand = Object.freeze({
      commandId: snapshot.id, correlationId, publicOrderId: snapshot.order.publicOrderId, requestHash: snapshot.requestHash,
      product: 'Patrol Evidence Platform', plan: 'annual', installationId: snapshot.order.purchaseRequest.installationId,
      machineFingerprint: this.encryption.decrypt(snapshot.order.purchaseRequest.machineFingerprintEnc), companyName: snapshot.order.purchaseRequest.companyName,
      licenceId: snapshot.licenceId, issuedAt: snapshot.issuedAt.toISOString(), startsAt: this.date(snapshot.startsAt), expiresAt: this.date(snapshot.expiresAt),
      features: { ...ALL_LICENCE_FEATURES }, maxDevices: 1, predecessorLicenceId: snapshot.predecessorLicenceId,
    });
    try {
      const result = await this.issuer.issue(command);
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.commercialLicenceIssuance.findUniqueOrThrow({ where: { id: snapshot.id }, include: { order: true, artifacts: true } });
        if (current.status === CommercialIssuanceStatus.ISSUED && current.artifacts[0]) return { issuance: current, artifact: current.artifacts[0], idempotent: true };
        if (current.status !== CommercialIssuanceStatus.PROCESSING || current.order.state !== CommercialOrderState.ISSUANCE_PENDING) throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_CONFLICT, 'Commercial state changed while signing.', 409);
        const payment = await tx.commercialPayment.findFirst({ where: { orderId: current.orderId, status: 'SUCCEEDED' } });
        if (!payment || current.order.refundedAt || current.order.holdReason) throw new ApiException(ERROR_CODES.COMMERCIAL_APPROVAL_PRECONDITION_FAILED, 'Payment eligibility changed while signing.', 409);
        const artifact = await tx.commercialLicenceArtifact.upsert({ where: { issuanceId: current.id }, create: { artifactId: result.artifact.artifactId, issuanceId: current.id, status: CommercialArtifactStatus.AVAILABLE, fileName: result.artifact.fileName, storageKey: result.artifact.storageKey, sha256: result.artifact.sha256, byteSize: result.artifact.byteSize, contentType: result.artifact.contentType, availableAt: new Date() }, update: {} });
        await createCommercialAudit(tx, this.auditService, { actorType: CommercialActorType.SYSTEM, action: 'commercial.artifact.stored', entityType: 'CommercialLicenceArtifact', entityId: artifact.id, customerId: current.customerId, correlationId, metadata: { artifactId: artifact.artifactId, sha256: artifact.sha256, byteSize: artifact.byteSize.toString(), contentType: artifact.contentType } });
        const issuance = await tx.commercialLicenceIssuance.update({ where: { id: current.id }, data: { status: CommercialIssuanceStatus.ISSUED, payloadHash: result.payloadHash, signingKeyId: result.signingKeyId } });
        await tx.commercialOrder.update({ where: { id: current.orderId }, data: { state: CommercialOrderState.ISSUED, stateVersion: { increment: 1 } } });
        await createCommercialAudit(tx, this.auditService, { actorType: CommercialActorType.SYSTEM, action: 'commercial.issuance.completed', entityType: 'CommercialLicenceIssuance', entityId: issuance.id, customerId: issuance.customerId, correlationId, metadata: { publicOrderId: current.order.publicOrderId, licenceId: result.licenceId, payloadHash: result.payloadHash, signingKeyId: result.signingKeyId, artifactId: artifact.artifactId } });
        await createCommercialOutboxEvent(tx, { idempotencyKey: `commercial-issuance:${issuance.id}:completed`, aggregateType: 'CommercialLicenceIssuance', aggregateId: issuance.id, eventType: 'commercial.issuance.completed', correlationId, payload: { issuanceId: issuance.id, artifactId: artifact.artifactId } });
        await createCommercialOutboxEvent(tx, { idempotencyKey: `commercial-delivery:${artifact.id}:initial`, aggregateType: 'CommercialLicenceArtifact', aggregateId: artifact.id, eventType: 'commercial.delivery.requested', correlationId, payload: { artifactId: artifact.id, kind: 'initial' } });
        return { issuance, artifact, idempotent: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await this.prisma.commercialLicenceIssuance.updateMany({ where: { id: snapshot.id, status: CommercialIssuanceStatus.PROCESSING }, data: { status: CommercialIssuanceStatus.FAILED, failureCode: this.safeCode(error) } });
      await this.auditService.record({ actorType: CommercialActorType.SYSTEM, action: error instanceof ApiException && error.code === ERROR_CODES.COMMERCIAL_LICENCE_VERIFICATION_FAILED ? 'commercial.issuance.verification_failed' : 'commercial.issuance.failed', entityType: 'CommercialLicenceIssuance', entityId: snapshot.id, customerId: snapshot.customerId, correlationId, metadata: { failureCode: this.safeCode(error) } });
      throw error;
    }
  }

  private async decide(publicOrderId: string, reason: string, admin: AuthenticatedAdmin, stepUpToken: string | undefined, target: CommercialOrderState, permission: CommercialOperatorPermission, action: string, correlationId: string) {
    this.assertPermission(admin, permission);
    return this.prisma.$transaction(async (tx) => {
      await this.stepUp.consume(tx, admin, stepUpToken, correlationId);
      const order = await tx.commercialOrder.findUnique({ where: { publicOrderId }, include: { issuance: true } });
      if (!order) throw new ApiException(ERROR_CODES.COMMERCIAL_ORDER_NOT_FOUND, 'Commercial order was not found.', 404);
      if (order.state !== CommercialOrderState.PAID_AWAITING_APPROVAL || order.issuance) throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_INVALID, 'This paid order cannot receive that decision.', 409);
      const updated = await tx.commercialOrder.update({ where: { id: order.id }, data: target === CommercialOrderState.HELD ? { state: target, heldFromState: order.state, holdReason: reason.trim(), stateVersion: { increment: 1 } } : { state: target, failureCode: 'OPERATOR_REJECTED', failureMessage: reason.trim(), stateVersion: { increment: 1 } } });
      await createCommercialAudit(tx, this.auditService, { actorType: CommercialActorType.OPERATOR, actorAdminId: admin.sub, action, entityType: 'CommercialOrder', entityId: order.id, customerId: order.customerId, correlationId, metadata: { reason: reason.trim(), paymentRetained: true, automaticRefund: false } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private assertTransactionalApprovalState(order: any) {
    if (order.state !== CommercialOrderState.PAID_AWAITING_APPROVAL || order.refundedAt || order.cancelledAt || order.holdReason || !order.customerId || !order.customer || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(order.customer.email) || order.product !== 'Patrol Evidence Platform' || order.purchaseRequest.product !== 'Patrol Evidence Platform' || order.requestHashSnapshot !== order.purchaseRequest.canonicalRequestHash || order.plan !== 'ANNUAL' || order.purchaseRequest.plan !== 'ANNUAL' || order.amountMinor !== 29900 || order.currency !== 'GBP' || !order.payments.some((p: any) => p.status === 'SUCCEEDED' && p.amountMinor === 29900 && p.currency === 'GBP')) throw new ApiException(ERROR_CODES.COMMERCIAL_APPROVAL_PRECONDITION_FAILED, 'Commercial order changed before approval completed.', 409);
  }

  private async licenceWindow(previousLicenceId: string | null, issuedAt: Date) {
    let startsAt = this.utcDate(issuedAt);
    if (previousLicenceId) {
      const predecessor = await this.prisma.commercialLicenceIssuance.findUnique({ where: { licenceId: previousLicenceId } });
      if (!predecessor?.expiresAt || predecessor.status !== CommercialIssuanceStatus.ISSUED) throw new ApiException(ERROR_CODES.COMMERCIAL_APPROVAL_PRECONDITION_FAILED, 'Renewal predecessor is not an issued commercial licence.', 409);
      if (predecessor.expiresAt >= startsAt) startsAt = this.addUtcDays(predecessor.expiresAt, 1);
    }
    return { startsAt, expiresAt: this.addUtcDays(this.addUtcYears(startsAt, 1), -1) };
  }

  private safeReview(order: any) {
    const payment = order.payments?.[0];
    return { publicOrderId: order.publicOrderId, state: order.state, customer: order.customer ? { id: order.customer.id, companyName: order.customer.companyName, email: order.customer.email } : null, companyName: order.purchaseRequest.companyName, product: order.product, plan: 'annual', amountMinor: order.amountMinor, currency: order.currency, payment: payment ? { status: payment.status, paidAt: payment.paidAt } : null, requestAgeSeconds: Math.max(0, Math.floor((Date.now() - order.purchaseRequest.createdAt.getTime()) / 1000)), appVersion: order.purchaseRequest.appVersion, buildId: order.purchaseRequest.buildId, workstationSummary: `...${order.purchaseRequest.machineFingerprintHash.slice(-8)}`, previousLicenceId: order.purchaseRequest.previousLicenceId, holdReason: order.holdReason, issuance: order.issuance ? { status: order.issuance.status, licenceId: order.issuance.licenceId } : null };
  }

  private assertPermission(admin: AuthenticatedAdmin, permission: CommercialOperatorPermission) { if (!adminHasCommercialPermission(admin.role, permission)) throw new ApiException(ERROR_CODES.COMMERCIAL_OPERATOR_FORBIDDEN, 'Commercial operator permission is required.', 403); }
  private async auditDenied(orderId: string, customerId: string | null, admin: AuthenticatedAdmin, correlationId: string, reason: string) { await this.auditService.record({ actorType: CommercialActorType.OPERATOR, actorAdminId: admin.sub, action: 'commercial.approval.denied', entityType: 'CommercialOrder', entityId: orderId, customerId, correlationId, metadata: { reason } }); }
  private safeCode(error: unknown) { return error instanceof ApiException ? error.code : 'COMMERCIAL_ISSUANCE_EXECUTION_FAILED'; }
  private date(value: Date) { return value.toISOString().slice(0, 10); }
  private utcDate(value: Date) { return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`); }
  private addUtcDays(value: Date, days: number) { const copy = new Date(value); copy.setUTCDate(copy.getUTCDate() + days); return copy; }
  private addUtcYears(value: Date, years: number) { const copy = new Date(value); copy.setUTCFullYear(copy.getUTCFullYear() + years); return copy; }
}
