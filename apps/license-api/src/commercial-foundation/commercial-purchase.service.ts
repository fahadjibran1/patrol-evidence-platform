import { Injectable } from '@nestjs/common';
import { CommercialActorType, CommercialOrderPurpose, CommercialPlan, PurchaseReferenceStatus, PurchaseRequestStatus } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { EncryptionService } from '@/crypto/encryption.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import {
  COMMERCIAL_PRODUCT,
  OPAQUE_REFERENCE_BYTES,
  PURCHASE_REFERENCE_SCOPE,
  PURCHASE_REFERENCE_TTL_MS,
} from './commercial.constants';
import { PurchaseRequestValidator } from './purchase-request.validator';
import { createCommercialAudit, createCommercialOutboxEvent } from './commercial-persistence.util';
import { hashPurchaseReference, taggedCommercialHash } from './commercial-hash.util';

export interface PurchaseRequestCreatedResult {
  requestId: string;
  publicOrderId: string;
  purchaseReference: string;
  referenceExpiresAt: string;
  status: 'REQUEST_CREATED';
}

export interface PurchaseReferenceExchangeResult {
  requestId: string;
  publicOrderId: string;
  product: typeof COMMERCIAL_PRODUCT;
  plan: 'annual';
  companyName: string;
  appVersion: string;
  buildId: string;
  requestExpiresAt: string;
}

@Injectable()
export class CommercialPurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly auditService: AuditService,
    private readonly validator: PurchaseRequestValidator,
  ) {}

  async createPurchaseRequest(input: unknown, now = new Date()): Promise<PurchaseRequestCreatedResult> {
    const validated = await this.validator.validate(input);
    const reference = randomBytes(OPAQUE_REFERENCE_BYTES).toString('base64url');
    const referenceHash = hashPurchaseReference(reference);
    const nonceHash = taggedCommercialHash('nonce', validated.request.clientNonce);
    const machineFingerprintHash = taggedCommercialHash('machine-fingerprint', validated.request.machineFingerprint);
    const machineFingerprintEnc = this.encryption.encrypt(validated.request.machineFingerprint);
    const expiresAt = new Date(now.getTime() + PURCHASE_REFERENCE_TTL_MS);
    const publicOrderId = `ord_${randomUUID()}`;
    const correlationId = randomUUID();

    try {
      await this.prisma.$transaction(async (tx) => {
        const purchaseRequest = await tx.commercialPurchaseRequest.create({
          data: {
            requestId: validated.request.requestId,
            schemaVersion: validated.request.schemaVersion,
            product: validated.request.product,
            plan: CommercialPlan.ANNUAL,
            installationId: validated.request.installationId,
            machineFingerprintEnc,
            machineFingerprintHash,
            companyName: validated.request.companyName,
            appVersion: validated.request.appVersion,
            buildId: validated.request.buildId,
            clientNonceHash: nonceHash,
            previousLicenceId: validated.request.previousLicenceId,
            canonicalRequestHash: validated.canonicalHash,
            createdAt: now,
            expiresAt,
            references: {
              create: {
                referenceHash,
                scope: PURCHASE_REFERENCE_SCOPE,
                createdAt: now,
                expiresAt,
              },
            },
            orders: {
              create: {
                publicOrderId,
                requestHashSnapshot: validated.canonicalHash,
                purpose: validated.request.previousLicenceId
                  ? CommercialOrderPurpose.RENEWAL
                  : CommercialOrderPurpose.INITIAL,
                product: validated.request.product,
                plan: CommercialPlan.ANNUAL,
                createdAt: now,
              },
            },
          },
        });

        await createCommercialAudit(tx, this.auditService, {
          actorType: CommercialActorType.DESKTOP,
          action: 'commercial.purchase_request.created',
          entityType: 'CommercialPurchaseRequest',
          entityId: purchaseRequest.id,
          correlationId,
          metadata: {
            requestId: validated.request.requestId,
            publicOrderId,
            product: validated.request.product,
            plan: validated.request.plan,
            appVersion: validated.request.appVersion,
            buildId: validated.request.buildId,
            renewal: Boolean(validated.request.previousLicenceId),
          },
        });
        await createCommercialOutboxEvent(tx, {
          idempotencyKey: `purchase-request:${purchaseRequest.id}:created`,
          aggregateType: 'CommercialPurchaseRequest',
          aggregateId: purchaseRequest.id,
          eventType: 'commercial.purchase_request.created',
          correlationId,
          payload: {
            purchaseRequestId: purchaseRequest.id,
            publicOrderId,
            requestId: validated.request.requestId,
          },
        });
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ApiException(
          ERROR_CODES.COMMERCIAL_REQUEST_DUPLICATE,
          'This purchase request or nonce has already been submitted.',
          409,
        );
      }
      throw error;
    }

    return {
      requestId: validated.request.requestId,
      publicOrderId,
      purchaseReference: reference,
      referenceExpiresAt: expiresAt.toISOString(),
      status: 'REQUEST_CREATED',
    };
  }

  async exchangePurchaseReference(
    rawReference: string,
    now = new Date(),
  ): Promise<PurchaseReferenceExchangeResult> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawReference)) {
      throw this.invalidReference();
    }
    const referenceHash = hashPurchaseReference(rawReference);
    const correlationId = randomUUID();

    const outcome = await this.prisma.$transaction(async (tx) => {
      const stored = await tx.commercialPurchaseReference.findUnique({
        where: { referenceHash },
        include: {
          purchaseRequest: {
            include: { orders: true },
          },
        },
      });
      if (!stored || stored.scope !== PURCHASE_REFERENCE_SCOPE) {
        return { kind: 'invalid' as const };
      }

      const expired = stored.expiresAt <= now || stored.purchaseRequest.expiresAt <= now;
      if (expired) {
        if (stored.status === PurchaseReferenceStatus.ACTIVE) {
          await tx.commercialPurchaseReference.update({
            where: { id: stored.id },
            data: { status: PurchaseReferenceStatus.EXPIRED },
          });
          await tx.commercialPurchaseRequest.update({
            where: { id: stored.purchaseRequestId },
            data: { status: PurchaseRequestStatus.EXPIRED },
          });
          await createCommercialAudit(tx, this.auditService, {
            actorType: CommercialActorType.SYSTEM,
            action: 'commercial.purchase_reference.expired',
            entityType: 'CommercialPurchaseReference',
            entityId: stored.id,
            correlationId,
            metadata: { requestId: stored.purchaseRequest.requestId },
          });
        }
        return { kind: 'expired' as const };
      }

      if (
        stored.status !== PurchaseReferenceStatus.ACTIVE
        || stored.purchaseRequest.status !== PurchaseRequestStatus.ACTIVE
      ) {
        await createCommercialAudit(tx, this.auditService, {
          actorType: CommercialActorType.SYSTEM,
          action: 'commercial.purchase_reference.replay_rejected',
          entityType: 'CommercialPurchaseReference',
          entityId: stored.id,
          correlationId,
          metadata: { requestId: stored.purchaseRequest.requestId, status: stored.status },
        });
        return { kind: 'replayed' as const };
      }

      const order = stored.purchaseRequest.orders[0];
      if (!order) {
        return { kind: 'invalid' as const };
      }

      const updated = await tx.commercialPurchaseReference.updateMany({
        where: { id: stored.id, status: PurchaseReferenceStatus.ACTIVE },
        data: {
          status: PurchaseReferenceStatus.CONSUMED,
          consumedAt: now,
          exchangeCount: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        return { kind: 'replayed' as const };
      }
      await tx.commercialPurchaseRequest.update({
        where: { id: stored.purchaseRequestId },
        data: { status: PurchaseRequestStatus.EXCHANGED, exchangedAt: now },
      });
      await createCommercialAudit(tx, this.auditService, {
        actorType: CommercialActorType.SYSTEM,
        action: 'commercial.purchase_reference.exchanged',
        entityType: 'CommercialPurchaseReference',
        entityId: stored.id,
        correlationId,
        metadata: { requestId: stored.purchaseRequest.requestId, publicOrderId: order.publicOrderId },
      });
      await createCommercialOutboxEvent(tx, {
        idempotencyKey: `purchase-reference:${stored.id}:consumed`,
        aggregateType: 'CommercialPurchaseRequest',
        aggregateId: stored.purchaseRequestId,
        eventType: 'commercial.purchase_reference.exchanged',
        correlationId,
        payload: { purchaseRequestId: stored.purchaseRequestId, publicOrderId: order.publicOrderId },
      });

      return {
        kind: 'ok' as const,
        value: {
          requestId: stored.purchaseRequest.requestId,
          publicOrderId: order.publicOrderId,
          product: COMMERCIAL_PRODUCT as typeof COMMERCIAL_PRODUCT,
          plan: 'annual' as const,
          companyName: stored.purchaseRequest.companyName,
          appVersion: stored.purchaseRequest.appVersion,
          buildId: stored.purchaseRequest.buildId,
          requestExpiresAt: stored.purchaseRequest.expiresAt.toISOString(),
        },
      };
    });

    if (outcome.kind === 'ok') return outcome.value;
    if (outcome.kind === 'expired') {
      throw new ApiException(ERROR_CODES.COMMERCIAL_REFERENCE_EXPIRED, 'Purchase reference is no longer valid.', 410);
    }
    if (outcome.kind === 'replayed') {
      throw new ApiException(ERROR_CODES.COMMERCIAL_REFERENCE_REPLAYED, 'Purchase reference has already been used.', 409);
    }
    throw this.invalidReference();
  }

  private invalidReference(): ApiException {
    return new ApiException(ERROR_CODES.COMMERCIAL_REFERENCE_INVALID, 'Purchase reference is not valid.', 404);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
  }
}
