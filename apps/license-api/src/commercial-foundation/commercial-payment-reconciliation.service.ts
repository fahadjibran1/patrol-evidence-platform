import { Inject, Injectable } from '@nestjs/common';
import {
  CommercialActorType,
  CommercialOrderState,
  CommercialPaymentStatus,
  CommercialProvider,
  CommercialProviderEventStatus,
  OutboxEventStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import {
  COMMERCIAL_PAYMENT_PROVIDER,
  type CommercialCheckoutSnapshot,
  type CommercialPaymentProvider,
  type CommercialPaymentSnapshot,
} from './commercial-payment-provider.port';
import { CommercialConfigService } from './commercial-config.service';
import { createCommercialAudit } from './commercial-persistence.util';

interface SafeEventMetadata {
  publicOrderId: string | null;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
}

@Injectable()
export class CommercialPaymentReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly config: CommercialConfigService,
    @Inject(COMMERCIAL_PAYMENT_PROVIDER) private readonly provider: CommercialPaymentProvider,
  ) {}

  async reconcileOutboxEvent(outboxId: string): Promise<{ outcome: string }> {
    const outbox = await this.prisma.commercialOutboxEvent.findUnique({ where: { id: outboxId } });
    if (!outbox || outbox.eventType !== 'commercial.provider_event.received') {
      throw new ApiException(ERROR_CODES.COMMERCIAL_OUTBOX_INVALID, 'Commercial provider outbox event was not found.', 404);
    }
    if (outbox.status === OutboxEventStatus.PUBLISHED) return { outcome: 'already_processed' };

    const providerEvent = await this.prisma.commercialProviderEvent.findUnique({
      where: { id: outbox.aggregateId },
    });
    if (!providerEvent) throw new ApiException(ERROR_CODES.COMMERCIAL_OUTBOX_INVALID, 'Provider event was not found.', 404);
    if (providerEvent.livemode || this.provider.getMode() !== 'TEST') {
      throw new ApiException(ERROR_CODES.COMMERCIAL_WEBHOOK_MODE_MISMATCH, 'Provider event mode mismatch.', 409);
    }

    const metadata = this.parseMetadata(providerEvent.safeMetadata);
    const order = await this.findOrder(metadata);
    if (!order) {
      await this.completeWithoutOrder(outbox.id, providerEvent.id, providerEvent.correlationId, 'unknown_order');
      return { outcome: 'ignored_unknown_order' };
    }

    const sessionId = metadata.checkoutSessionId ?? order.providerCheckoutSessionId;
    const paymentIntentId = metadata.paymentIntentId ?? order.providerPaymentIntentId;
    const checkout = sessionId ? await this.provider.retrieveCheckout(sessionId) : null;
    const payment = paymentIntentId ? await this.provider.retrievePayment(paymentIntentId) : null;
    const decision = this.decide(order, providerEvent.eventType, checkout, payment);

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.commercialOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { issuance: true },
      });
      const targetState = this.protectTerminalState(current.state, decision.targetState, Boolean(current.issuance));
      const protectionReason = targetState === CommercialOrderState.HELD && !decision.mismatchReason
        ? this.protectionReason(current.state, decision.targetState, Boolean(current.issuance))
        : null;
      const holdReason = decision.mismatchReason ?? protectionReason;
      const stateChanged = targetState !== current.state;

      if (checkout) {
        await tx.commercialCheckoutSession.updateMany({
          where: { providerSessionId: checkout.providerSessionId, orderId: current.id },
          data: {
            providerCustomerId: checkout.providerCustomerId,
            providerPaymentIntentId: checkout.paymentIntentId,
            status: checkout.status,
            isActive: checkout.status === 'open',
            closedAt: checkout.status === 'open' ? null : new Date(),
          },
        });
      }
      const effectivePaymentIntentId = payment?.paymentIntentId ?? checkout?.paymentIntentId ?? paymentIntentId;
      if (effectivePaymentIntentId) {
        await tx.commercialPayment.upsert({
          where: {
            provider_providerReference: {
              provider: CommercialProvider.STRIPE,
              providerReference: effectivePaymentIntentId,
            },
          },
          create: {
            orderId: current.id,
            provider: CommercialProvider.STRIPE,
            providerReference: effectivePaymentIntentId,
            providerMode: 'TEST',
            checkoutSessionId: checkout?.providerSessionId ?? sessionId,
            providerCustomerId: payment?.providerCustomerId ?? checkout?.providerCustomerId,
            status: decision.paymentStatus,
            amountMinor: payment?.amount ?? checkout?.amountTotal ?? this.config.getPolicy().amountMinor,
            taxMinor: 0,
            currency: payment?.currency ?? checkout?.currency ?? this.config.getPolicy().currency,
            paidAt: decision.paymentStatus === CommercialPaymentStatus.SUCCEEDED ? new Date() : null,
            refundedAt: decision.paymentStatus === CommercialPaymentStatus.REFUNDED ? new Date() : null,
          },
          update: {
            status: decision.paymentStatus,
            providerCustomerId: payment?.providerCustomerId ?? checkout?.providerCustomerId,
            paidAt: decision.paymentStatus === CommercialPaymentStatus.SUCCEEDED ? new Date() : undefined,
            refundedAt: decision.paymentStatus === CommercialPaymentStatus.REFUNDED ? new Date() : undefined,
          },
        });
      }

      await tx.commercialOrder.update({
        where: { id: current.id },
        data: {
          state: targetState,
          stateVersion: stateChanged ? { increment: 1 } : undefined,
          heldFromState: targetState === CommercialOrderState.HELD && current.state !== CommercialOrderState.HELD
            ? current.state
            : undefined,
          holdReason: targetState === CommercialOrderState.HELD ? holdReason : undefined,
          refundedAt: targetState === CommercialOrderState.REFUNDED ? new Date() : undefined,
          providerCheckoutSessionId: checkout?.providerSessionId ?? undefined,
          providerPaymentIntentId: effectivePaymentIntentId ?? undefined,
          providerCustomerId: payment?.providerCustomerId ?? checkout?.providerCustomerId ?? undefined,
          checkoutStatus: checkout?.status ?? undefined,
          checkoutExpiresAt: checkout?.expiresAt ?? undefined,
        },
      });
      await tx.commercialProviderEvent.update({
        where: { id: providerEvent.id },
        data: { status: CommercialProviderEventStatus.PROCESSED, processedAt: new Date(), lastError: null },
      });
      await tx.commercialOutboxEvent.update({
        where: { id: outbox.id },
        data: { status: OutboxEventStatus.PUBLISHED, publishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
      });
      await createCommercialAudit(tx, this.auditService, {
        actorType: CommercialActorType.PROVIDER,
        actorId: 'stripe',
        action: decision.auditAction,
        entityType: 'CommercialOrder',
        entityId: current.id,
        customerId: current.customerId,
        correlationId: providerEvent.correlationId ?? outbox.correlationId,
        metadata: {
          publicOrderId: current.publicOrderId,
          providerEventId: providerEvent.providerEventId,
          eventType: providerEvent.eventType,
          fromState: current.state,
          toState: targetState,
          mismatch: holdReason,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { outcome: decision.auditAction };
  }

  private decide(
    order: {
      amountMinor: number | null;
      currency: string | null;
      state: CommercialOrderState;
      publicOrderId: string;
      providerCustomerId: string | null;
      providerPaymentIntentId: string | null;
    },
    eventType: string,
    checkout: CommercialCheckoutSnapshot | null,
    payment: CommercialPaymentSnapshot | null,
  ) {
    const policy = this.config.getPolicy();
    const mismatch = this.findMismatch(order, checkout, payment);
    if (mismatch) {
      return {
        targetState: CommercialOrderState.HELD,
        paymentStatus: CommercialPaymentStatus.PENDING,
        mismatchReason: mismatch,
        auditAction: 'commercial.payment.mismatch_held',
      };
    }

    const refunded = eventType.includes('refund') || eventType === 'charge.refunded' || (payment?.amountRefunded ?? 0) > 0;
    if (refunded) {
      return {
        targetState: CommercialOrderState.REFUNDED,
        paymentStatus: CommercialPaymentStatus.REFUNDED,
        mismatchReason: null,
        auditAction: 'commercial.payment.refunded',
      };
    }
    const paid = checkout?.paymentStatus === 'paid'
      || payment?.status === 'succeeded'
      || (payment?.amountReceived ?? 0) >= policy.amountMinor;
    if (paid) {
      return {
        targetState: CommercialOrderState.PAID_AWAITING_APPROVAL,
        paymentStatus: CommercialPaymentStatus.SUCCEEDED,
        mismatchReason: null,
        auditAction: 'commercial.payment.settled',
      };
    }
    const failed = payment?.status === 'canceled'
      || payment?.status === 'requires_payment_method'
      || eventType.includes('payment_failed');
    return {
      targetState: order.state === CommercialOrderState.REQUEST_CREATED
        ? CommercialOrderState.CHECKOUT_PENDING
        : CommercialOrderState.PAYMENT_PENDING,
      paymentStatus: failed ? CommercialPaymentStatus.FAILED : CommercialPaymentStatus.PENDING,
      mismatchReason: null,
      auditAction: failed ? 'commercial.payment.failed' : 'commercial.payment.pending',
    };
  }

  private findMismatch(
    order: {
      amountMinor: number | null;
      currency: string | null;
      publicOrderId: string;
      providerCustomerId: string | null;
      providerPaymentIntentId: string | null;
    },
    checkout: CommercialCheckoutSnapshot | null,
    payment: CommercialPaymentSnapshot | null,
  ): string | null {
    const policy = this.config.getPolicy();
    if (checkout?.livemode || payment?.livemode) return 'provider_mode_mismatch';
    if (order.amountMinor !== policy.amountMinor || order.currency !== policy.currency) return 'order_price_mismatch';
    if (checkout?.publicOrderId && checkout.publicOrderId !== order.publicOrderId) return 'checkout_order_mismatch';
    if (payment?.publicOrderId && payment.publicOrderId !== order.publicOrderId) return 'payment_order_mismatch';
    if (order.providerCustomerId && checkout?.providerCustomerId
      && order.providerCustomerId !== checkout.providerCustomerId) return 'checkout_customer_mismatch';
    if (order.providerCustomerId && payment?.providerCustomerId
      && order.providerCustomerId !== payment.providerCustomerId) return 'payment_customer_mismatch';
    if (checkout?.providerCustomerId && payment?.providerCustomerId
      && checkout.providerCustomerId !== payment.providerCustomerId) return 'provider_customer_mismatch';
    if (checkout?.paymentIntentId && payment
      && checkout.paymentIntentId !== payment.paymentIntentId) return 'payment_intent_mismatch';
    if (order.providerPaymentIntentId && payment
      && order.providerPaymentIntentId !== payment.paymentIntentId) return 'stored_payment_intent_mismatch';
    if (checkout?.amountTotal !== null && checkout?.amountTotal !== undefined && checkout.amountTotal !== policy.amountMinor) {
      return 'checkout_amount_mismatch';
    }
    if (checkout?.currency && checkout.currency !== policy.currency) return 'checkout_currency_mismatch';
    if (payment && payment.amount !== policy.amountMinor) return 'payment_amount_mismatch';
    if (payment && payment.currency !== policy.currency) return 'payment_currency_mismatch';
    return null;
  }

  private protectTerminalState(
    current: CommercialOrderState,
    proposed: CommercialOrderState,
    issuanceExists: boolean,
  ): CommercialOrderState {
    if (current === CommercialOrderState.REFUNDED || current === CommercialOrderState.HELD) return current;
    if (proposed === CommercialOrderState.REFUNDED && issuanceExists) return CommercialOrderState.HELD;
    if (current === CommercialOrderState.CANCELLED && proposed === CommercialOrderState.PAID_AWAITING_APPROVAL) {
      return CommercialOrderState.HELD;
    }
    if ((new Set<CommercialOrderState>([
      CommercialOrderState.ISSUANCE_PENDING,
      CommercialOrderState.ISSUED,
      CommercialOrderState.DELIVERY_PENDING,
      CommercialOrderState.DELIVERED,
    ])).has(current)) {
      return CommercialOrderState.HELD;
    }
    if (current === CommercialOrderState.PAID_AWAITING_APPROVAL && proposed !== CommercialOrderState.REFUNDED) {
      return current;
    }
    return proposed;
  }

  private protectionReason(
    current: CommercialOrderState,
    proposed: CommercialOrderState,
    issuanceExists: boolean,
  ): string {
    if (issuanceExists && proposed === CommercialOrderState.REFUNDED) return 'refund_after_issuance_requires_manual_action';
    if (current === CommercialOrderState.CANCELLED) return 'provider_settlement_after_cancellation';
    if ((new Set<CommercialOrderState>([
      CommercialOrderState.ISSUANCE_PENDING,
      CommercialOrderState.ISSUED,
      CommercialOrderState.DELIVERY_PENDING,
      CommercialOrderState.DELIVERED,
    ])).has(current)) return 'payment_event_after_issuance_started';
    return 'manual_reconciliation_required';
  }

  private async findOrder(metadata: SafeEventMetadata) {
    if (metadata.checkoutSessionId) {
      const checkout = await this.prisma.commercialCheckoutSession.findUnique({
        where: { providerSessionId: metadata.checkoutSessionId },
        include: { order: true },
      });
      if (checkout) return checkout.order;
    }
    if (metadata.paymentIntentId) {
      const byPayment = await this.prisma.commercialOrder.findFirst({
        where: {
          OR: [
            { providerPaymentIntentId: metadata.paymentIntentId },
            { payments: { some: { providerReference: metadata.paymentIntentId } } },
          ],
        },
      });
      if (byPayment) return byPayment;
    }
    if (metadata.publicOrderId) {
      return this.prisma.commercialOrder.findUnique({ where: { publicOrderId: metadata.publicOrderId } });
    }
    return null;
  }

  private parseMetadata(value: Prisma.JsonValue): SafeEventMetadata {
    const object = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, Prisma.JsonValue>
      : {};
    const read = (key: string) => typeof object[key] === 'string' ? object[key] as string : null;
    return {
      publicOrderId: read('publicOrderId'),
      checkoutSessionId: read('checkoutSessionId'),
      paymentIntentId: read('paymentIntentId'),
    };
  }

  private async completeWithoutOrder(
    outboxId: string,
    providerEventId: string,
    correlationId: string | null,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.commercialProviderEvent.update({
        where: { id: providerEventId },
        data: { status: CommercialProviderEventStatus.IGNORED, processedAt: new Date(), lastError: reason },
      });
      await tx.commercialOutboxEvent.update({
        where: { id: outboxId },
        data: { status: OutboxEventStatus.PUBLISHED, publishedAt: new Date(), lockedAt: null, lockedBy: null },
      });
      await createCommercialAudit(tx, this.auditService, {
        actorType: CommercialActorType.PROVIDER,
        actorId: 'stripe',
        action: 'commercial.provider_event.ignored',
        entityType: 'CommercialProviderEvent',
        entityId: providerEventId,
        correlationId: correlationId ?? outboxId,
        metadata: { reason },
      });
    });
  }
}
