import { Injectable } from '@nestjs/common';
import { CommercialOrderState, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { isCommercialTransitionAllowed } from './commercial-state-machine';
import { createCommercialAudit, createCommercialOutboxEvent } from './commercial-persistence.util';
import type { CommercialActorContext, CommercialTransitionInput } from './commercial.types';

class CommercialTransitionRaceError extends Error {}

@Injectable()
export class CommercialOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async transition(input: CommercialTransitionInput) {
    const correlationId = input.correlationId ?? randomUUID();
    const initial = await this.prisma.commercialOrder.findUnique({
      where: { publicOrderId: input.publicOrderId },
    });
    if (!initial) throw this.notFound();

    if (!isCommercialTransitionAllowed(initial.state, input.to)) {
      await this.auditRejected(initial.id, initial.customerId, initial.state, input.to, correlationId, input.actor);
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_TRANSITION_INVALID,
        `Commercial order cannot move from ${initial.state} to ${input.to}.`,
        409,
      );
    }
    this.assertTransitionContext(initial.state, input);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const nextVersion = initial.stateVersion + 1;
        const data: Prisma.CommercialOrderUpdateManyMutationInput = {
          state: input.to,
          stateVersion: { increment: 1 },
          ...(input.to === CommercialOrderState.FAILED
            ? {
                failedFromState: initial.state,
                failureCode: input.failureCode,
                failureMessage: this.sanitizeFailureMessage(input.failureMessage),
              }
            : {}),
          ...(input.to === CommercialOrderState.HELD
            ? { heldFromState: initial.state, holdReason: input.holdReason?.trim().slice(0, 500) }
            : {}),
          ...(input.to === CommercialOrderState.CANCELLED ? { cancelledAt: new Date() } : {}),
          ...(input.to === CommercialOrderState.REFUNDED ? { refundedAt: new Date() } : {}),
        };
        const changed = await tx.commercialOrder.updateMany({
          where: {
            id: initial.id,
            state: initial.state,
            stateVersion: initial.stateVersion,
          },
          data,
        });
        if (changed.count !== 1) throw new CommercialTransitionRaceError();

        await createCommercialAudit(tx, this.auditService, {
          actorType: input.actor.actorType,
          actorAdminId: input.actor.actorAdminId,
          actorCustomerUserId: input.actor.actorCustomerUserId,
          actorId: input.actor.actorId,
          action: 'commercial.order.transitioned',
          entityType: 'CommercialOrder',
          entityId: initial.id,
          customerId: initial.customerId,
          correlationId,
          ipAddress: input.actor.ipAddress,
          userAgent: input.actor.userAgent,
          metadata: {
            publicOrderId: initial.publicOrderId,
            fromState: initial.state,
            toState: input.to,
            stateVersion: nextVersion,
            ...input.metadata,
          },
        });
        await createCommercialOutboxEvent(tx, {
          idempotencyKey: `commercial-order:${initial.id}:state:${nextVersion}`,
          aggregateType: 'CommercialOrder',
          aggregateId: initial.id,
          eventType: 'commercial.order.state_changed',
          correlationId,
          payload: {
            publicOrderId: initial.publicOrderId,
            fromState: initial.state,
            toState: input.to,
            stateVersion: nextVersion,
          },
        });
        return tx.commercialOrder.findUniqueOrThrow({ where: { id: initial.id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof CommercialTransitionRaceError || this.isSerializationConflict(error)) {
        await this.auditRejected(initial.id, initial.customerId, initial.state, input.to, correlationId, input.actor, 'concurrent_update');
        throw new ApiException(
          ERROR_CODES.COMMERCIAL_TRANSITION_CONFLICT,
          'Commercial order changed concurrently. Reload and retry safely.',
          409,
        );
      }
      throw error;
    }
  }

  async retryFailed(publicOrderId: string, actor: CommercialActorContext, correlationId = randomUUID()) {
    const order = await this.prisma.commercialOrder.findUnique({ where: { publicOrderId } });
    if (!order) throw this.notFound();
    if (order.state !== CommercialOrderState.FAILED || !order.failedFromState) {
      await this.auditRejected(order.id, order.customerId, order.state, order.failedFromState ?? order.state, correlationId, actor, 'not_retryable');
      throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_INVALID, 'Commercial order is not retryable.', 409);
    }
    return this.restoreExceptionalState(order, order.failedFromState, actor, correlationId, 'commercial.order.retry_started');
  }

  async releaseHeld(publicOrderId: string, actor: CommercialActorContext, correlationId = randomUUID()) {
    const order = await this.prisma.commercialOrder.findUnique({ where: { publicOrderId } });
    if (!order) throw this.notFound();
    if (order.state !== CommercialOrderState.HELD || !order.heldFromState) {
      await this.auditRejected(order.id, order.customerId, order.state, order.heldFromState ?? order.state, correlationId, actor, 'not_releasable');
      throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_INVALID, 'Commercial order is not on a releasable hold.', 409);
    }
    return this.restoreExceptionalState(order, order.heldFromState, actor, correlationId, 'commercial.order.hold_released');
  }

  private async restoreExceptionalState(
    order: { id: string; publicOrderId: string; customerId: string | null; state: CommercialOrderState; stateVersion: number },
    target: CommercialOrderState,
    actor: CommercialActorContext,
    correlationId: string,
    action: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const nextVersion = order.stateVersion + 1;
      const changed = await tx.commercialOrder.updateMany({
        where: { id: order.id, state: order.state, stateVersion: order.stateVersion },
        data: {
          state: target,
          stateVersion: { increment: 1 },
          failureCode: null,
          failureMessage: null,
          failedFromState: null,
          holdReason: null,
          heldFromState: null,
        },
      });
      if (changed.count !== 1) throw new CommercialTransitionRaceError();
      await createCommercialAudit(tx, this.auditService, {
        actorType: actor.actorType,
        actorAdminId: actor.actorAdminId,
        actorCustomerUserId: actor.actorCustomerUserId,
        actorId: actor.actorId,
        action,
        entityType: 'CommercialOrder',
        entityId: order.id,
        customerId: order.customerId,
        correlationId,
        metadata: { publicOrderId: order.publicOrderId, fromState: order.state, toState: target, stateVersion: nextVersion },
      });
      await createCommercialOutboxEvent(tx, {
        idempotencyKey: `commercial-order:${order.id}:state:${nextVersion}`,
        aggregateType: 'CommercialOrder',
        aggregateId: order.id,
        eventType: action,
        correlationId,
        payload: { publicOrderId: order.publicOrderId, fromState: order.state, toState: target, stateVersion: nextVersion },
      });
      return tx.commercialOrder.findUniqueOrThrow({ where: { id: order.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private assertTransitionContext(from: CommercialOrderState, input: CommercialTransitionInput): void {
    if (input.to === CommercialOrderState.FAILED && !input.failureCode?.trim()) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_INVALID, 'A sanitized failure code is required.', 400);
    }
    if (input.to === CommercialOrderState.HELD && !input.holdReason?.trim()) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_INVALID, 'A hold reason is required.', 400);
    }
    if (from === CommercialOrderState.FAILED || from === CommercialOrderState.HELD) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_INVALID, 'Use the explicit recovery operation.', 409);
    }
  }

  private async auditRejected(
    orderId: string,
    customerId: string | null,
    from: CommercialOrderState,
    to: CommercialOrderState,
    correlationId: string,
    actor: CommercialActorContext,
    reason = 'prohibited_transition',
  ): Promise<void> {
    await this.auditService.record({
      actorType: actor.actorType,
      actorAdminId: actor.actorAdminId,
      actorCustomerUserId: actor.actorCustomerUserId,
      actorId: actor.actorId,
      action: 'commercial.order.transition_rejected',
      entityType: 'CommercialOrder',
      entityId: orderId,
      customerId,
      correlationId,
      metadata: { fromState: from, requestedState: to, reason },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  private sanitizeFailureMessage(message?: string): string | null {
    if (!message) return null;
    return message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  }

  private notFound(): ApiException {
    return new ApiException(ERROR_CODES.COMMERCIAL_ORDER_NOT_FOUND, 'Commercial order was not found.', 404);
  }

  private isSerializationConflict(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2034');
  }
}
