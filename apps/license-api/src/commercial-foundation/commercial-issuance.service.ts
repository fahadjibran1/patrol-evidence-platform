import { Inject, Injectable } from '@nestjs/common';
import {
  CommercialActorType,
  CommercialArtifactStatus,
  CommercialIssuanceStatus,
  CommercialIssuanceType,
  CommercialOrderState,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { EncryptionService } from '@/crypto/encryption.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import {
  COMMERCIAL_LICENCE_ISSUER,
  type CommercialLicenceIssuer,
  type IssueCommercialLicenceCommand,
} from './commercial-issuer.port';
import { createCommercialAudit, createCommercialOutboxEvent } from './commercial-persistence.util';
import type { CommercialActorContext } from './commercial.types';

@Injectable()
export class CommercialIssuanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly auditService: AuditService,
    @Inject(COMMERCIAL_LICENCE_ISSUER) private readonly issuer: CommercialLicenceIssuer,
  ) {}

  async approve(input: {
    publicOrderId: string;
    startsAt: string;
    expiresAt: string;
    actor: CommercialActorContext & { actorAdminId: string };
    correlationId?: string;
    reissueReason?: string;
  }) {
    this.assertDateWindow(input.startsAt, input.expiresAt);
    const correlationId = input.correlationId ?? randomUUID();
    const order = await this.prisma.commercialOrder.findUnique({
      where: { publicOrderId: input.publicOrderId },
      include: { purchaseRequest: true, issuance: true },
    });
    if (!order) throw new ApiException(ERROR_CODES.COMMERCIAL_ORDER_NOT_FOUND, 'Commercial order was not found.', 404);

    if (order.issuance) {
      const sameWindow =
        order.issuance.startsAt?.toISOString().slice(0, 10) === input.startsAt
        && order.issuance.expiresAt?.toISOString().slice(0, 10) === input.expiresAt;
      if (
        sameWindow
        && (order.state === CommercialOrderState.ISSUANCE_PENDING || order.state === CommercialOrderState.ISSUED)
      ) {
        return order.issuance;
      }
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUANCE_NOT_ALLOWED, 'An issuance already exists for this order.', 409);
    }
    if (order.state !== CommercialOrderState.PAID_AWAITING_APPROVAL) {
      await this.auditRejected(order.id, order.customerId, order.state, correlationId, input.actor);
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_ISSUANCE_NOT_ALLOWED,
        'Licence issuance requires a reconciled paid order and operator approval.',
        409,
      );
    }
    if (!order.customerId) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUANCE_NOT_ALLOWED, 'Order has no verified customer.', 409);
    }

    const issuanceType = order.purpose === 'INITIAL'
      ? CommercialIssuanceType.INITIAL
      : order.purpose === 'RENEWAL'
        ? CommercialIssuanceType.RENEWAL
        : CommercialIssuanceType.REISSUE;
    if (issuanceType === CommercialIssuanceType.REISSUE && !input.reissueReason?.trim()) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUANCE_NOT_ALLOWED, 'Reissue requires an explicit reason.', 400);
    }

    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.commercialOrder.updateMany({
        where: { id: order.id, state: CommercialOrderState.PAID_AWAITING_APPROVAL, stateVersion: order.stateVersion },
        data: { state: CommercialOrderState.ISSUANCE_PENDING, stateVersion: { increment: 1 } },
      });
      if (changed.count !== 1) {
        throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_CONFLICT, 'Commercial order changed concurrently.', 409);
      }
      const issuance = await tx.commercialLicenceIssuance.create({
        data: {
          orderId: order.id,
          customerId: order.customerId,
          issuanceType,
          status: CommercialIssuanceStatus.APPROVED,
          predecessorLicenceId: order.purchaseRequest.previousLicenceId,
          reissueReason: input.reissueReason?.trim() || null,
          requestHash: order.purchaseRequest.canonicalRequestHash,
          startsAt: new Date(`${input.startsAt}T00:00:00.000Z`),
          expiresAt: new Date(`${input.expiresAt}T00:00:00.000Z`),
          approvedByAdminId: input.actor.actorAdminId,
          approvedAt: new Date(),
        },
      });
      await createCommercialAudit(tx, this.auditService, {
        actorType: CommercialActorType.OPERATOR,
        actorAdminId: input.actor.actorAdminId,
        action: 'commercial.issuance.approved',
        entityType: 'CommercialLicenceIssuance',
        entityId: issuance.id,
        customerId: order.customerId,
        correlationId,
        metadata: { publicOrderId: order.publicOrderId, issuanceType, startsAt: input.startsAt, expiresAt: input.expiresAt },
      });
      await createCommercialOutboxEvent(tx, {
        idempotencyKey: `commercial-issuance:${issuance.id}:approved`,
        aggregateType: 'CommercialLicenceIssuance',
        aggregateId: issuance.id,
        eventType: 'commercial.issuance.approved',
        correlationId,
        payload: { issuanceId: issuance.id, publicOrderId: order.publicOrderId },
      });
      return issuance;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async processApproved(publicOrderId: string, correlationId = randomUUID()) {
    const order = await this.prisma.commercialOrder.findUnique({
      where: { publicOrderId },
      include: {
        purchaseRequest: true,
        issuance: { include: { artifacts: true } },
      },
    });
    if (!order || !order.issuance) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUANCE_NOT_ALLOWED, 'Approved issuance was not found.', 409);
    }
    const existingArtifact = order.issuance.artifacts[0];
    if (order.state === CommercialOrderState.ISSUED && existingArtifact) {
      return { issuance: order.issuance, artifact: existingArtifact, idempotent: true };
    }
    if (
      order.state !== CommercialOrderState.ISSUANCE_PENDING
      || (
        order.issuance.status !== CommercialIssuanceStatus.APPROVED
        && order.issuance.status !== CommercialIssuanceStatus.FAILED
      )
      || !order.issuance.startsAt
      || !order.issuance.expiresAt
    ) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUANCE_NOT_ALLOWED, 'Issuance is not ready for processing.', 409);
    }

    const claimed = await this.prisma.commercialLicenceIssuance.updateMany({
      where: {
        id: order.issuance.id,
        status: { in: [CommercialIssuanceStatus.APPROVED, CommercialIssuanceStatus.FAILED] },
      },
      data: { status: CommercialIssuanceStatus.PROCESSING, failureCode: null },
    });
    if (claimed.count !== 1) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_CONFLICT, 'Issuance is already being processed.', 409);
    }

    const command: IssueCommercialLicenceCommand = Object.freeze({
      commandId: order.issuance.id,
      correlationId,
      publicOrderId: order.publicOrderId,
      requestHash: order.purchaseRequest.canonicalRequestHash,
      product: 'Patrol Evidence Platform',
      plan: 'annual',
      installationId: order.purchaseRequest.installationId,
      machineFingerprint: this.encryption.decrypt(order.purchaseRequest.machineFingerprintEnc),
      companyName: order.purchaseRequest.companyName,
      startsAt: order.issuance.startsAt.toISOString().slice(0, 10),
      expiresAt: order.issuance.expiresAt.toISOString().slice(0, 10),
      maxDevices: 1,
      predecessorLicenceId: order.issuance.predecessorLicenceId,
    });

    try {
      const result = await this.issuer.issue(command);
      return await this.prisma.$transaction(async (tx) => {
        const artifact = await tx.commercialLicenceArtifact.create({
          data: {
            artifactId: result.artifact.artifactId,
            issuanceId: order.issuance!.id,
            status: CommercialArtifactStatus.AVAILABLE,
            fileName: result.artifact.fileName,
            storageKey: result.artifact.storageKey,
            sha256: result.artifact.sha256.toLowerCase(),
            byteSize: result.artifact.byteSize,
            contentType: result.artifact.contentType,
            availableAt: new Date(),
          },
        });
        const issuance = await tx.commercialLicenceIssuance.update({
          where: { id: order.issuance!.id },
          data: {
            status: CommercialIssuanceStatus.ISSUED,
            licenceId: result.licenceId,
            payloadHash: result.payloadHash.toLowerCase(),
            signingKeyId: result.signingKeyId,
          },
        });
        const changed = await tx.commercialOrder.updateMany({
          where: { id: order.id, state: CommercialOrderState.ISSUANCE_PENDING, stateVersion: order.stateVersion },
          data: { state: CommercialOrderState.ISSUED, stateVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw new Error('Commercial order changed while issuer was running.');
        await createCommercialAudit(tx, this.auditService, {
          actorType: CommercialActorType.SYSTEM,
          action: 'commercial.issuance.completed',
          entityType: 'CommercialLicenceIssuance',
          entityId: issuance.id,
          customerId: order.customerId,
          correlationId,
          metadata: {
            publicOrderId: order.publicOrderId,
            licenceId: result.licenceId,
            payloadHash: result.payloadHash,
            signingKeyId: result.signingKeyId,
            artifactId: result.artifact.artifactId,
          },
        });
        await createCommercialOutboxEvent(tx, {
          idempotencyKey: `commercial-issuance:${issuance.id}:issued`,
          aggregateType: 'CommercialLicenceIssuance',
          aggregateId: issuance.id,
          eventType: 'commercial.issuance.completed',
          correlationId,
          payload: { issuanceId: issuance.id, artifactId: artifact.artifactId, publicOrderId: order.publicOrderId },
        });
        return { issuance, artifact, idempotent: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await this.recordIssuanceFailure(order.id, order.stateVersion, order.issuance.id, correlationId, error);
      throw error;
    }
  }

  private async recordIssuanceFailure(
    orderId: string,
    stateVersion: number,
    issuanceId: string,
    correlationId: string,
    error: unknown,
  ): Promise<void> {
    const code = error instanceof ApiException ? error.code : 'ISSUER_EXECUTION_FAILED';
    await this.prisma.$transaction(async (tx) => {
      await tx.commercialLicenceIssuance.update({
        where: { id: issuanceId },
        data: { status: CommercialIssuanceStatus.FAILED, failureCode: code },
      });
      await tx.commercialOrder.updateMany({
        where: { id: orderId, state: CommercialOrderState.ISSUANCE_PENDING, stateVersion },
        data: {
          state: CommercialOrderState.FAILED,
          stateVersion: { increment: 1 },
          failedFromState: CommercialOrderState.ISSUANCE_PENDING,
          failureCode: code,
          failureMessage: 'Isolated licence issuer did not complete.',
        },
      });
      await createCommercialAudit(tx, this.auditService, {
        actorType: CommercialActorType.SYSTEM,
        action: 'commercial.issuance.failed',
        entityType: 'CommercialLicenceIssuance',
        entityId: issuanceId,
        correlationId,
        metadata: { failureCode: code },
      });
      await createCommercialOutboxEvent(tx, {
        idempotencyKey: `commercial-issuance:${issuanceId}:failed:${stateVersion + 1}`,
        aggregateType: 'CommercialLicenceIssuance',
        aggregateId: issuanceId,
        eventType: 'commercial.issuance.failed',
        correlationId,
        payload: { issuanceId, failureCode: code },
      });
    });
  }

  private async auditRejected(
    orderId: string,
    customerId: string | null,
    state: CommercialOrderState,
    correlationId: string,
    actor: CommercialActorContext,
  ): Promise<void> {
    await this.auditService.record({
      actorType: actor.actorType,
      actorAdminId: actor.actorAdminId,
      actorCustomerUserId: actor.actorCustomerUserId,
      action: 'commercial.issuance.approval_rejected',
      entityType: 'CommercialOrder',
      entityId: orderId,
      customerId,
      correlationId,
      metadata: { orderState: state, reason: 'paid_approval_required' },
    });
  }

  private assertDateWindow(startsAt: string, expiresAt: string): void {
    const date = /^\d{4}-\d{2}-\d{2}$/;
    if (!date.test(startsAt) || !date.test(expiresAt) || startsAt >= expiresAt) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUANCE_NOT_ALLOWED, 'Issuance date window is invalid.', 400);
    }
  }
}
