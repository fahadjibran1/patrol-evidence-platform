import { Inject, Injectable } from '@nestjs/common';
import {
  CommercialActorType,
  CommercialOrderState,
  CommercialPlan,
  CommercialProvider,
  CommercialProviderMode,
  CustomerStatus,
  Prisma,
  PurchaseReferenceStatus,
  PurchaseRequestStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import {
  COMMERCIAL_CHECKOUT_SCOPE,
  COMMERCIAL_CURRENCY,
  COMMERCIAL_PRODUCT,
} from './commercial.constants';
import { CommercialConfigService } from './commercial-config.service';
import {
  COMMERCIAL_PAYMENT_PROVIDER,
  type CommercialCheckoutSnapshot,
  type CommercialPaymentProvider,
} from './commercial-payment-provider.port';
import { hashPurchaseReference } from './commercial-hash.util';
import { createCommercialAudit, createCommercialOutboxEvent } from './commercial-persistence.util';

export interface CommercialCheckoutResult {
  publicOrderId: string;
  checkoutUrl: string;
  providerSessionId: string;
  expiresAt: string | null;
  status: string;
  amountMinor: number;
  currency: string;
  duplicate: boolean;
}

export interface CommercialCheckoutContact {
  customerEmail: string;
  contactName?: string;
}

@Injectable()
export class CommercialCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly config: CommercialConfigService,
    @Inject(COMMERCIAL_PAYMENT_PROVIDER) private readonly provider: CommercialPaymentProvider,
  ) {}

  async inspectOpaqueReference(rawReference: string, now = new Date()) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawReference)) throw this.invalidReference();
    const stored = await this.prisma.commercialPurchaseReference.findUnique({
      where: { referenceHash: hashPurchaseReference(rawReference) },
      include: { purchaseRequest: { include: { orders: true } } },
    });
    if (!stored || stored.scope !== 'patrolsafe.purchase') throw this.invalidReference();
    if (stored.expiresAt <= now || stored.purchaseRequest.expiresAt <= now) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_REFERENCE_EXPIRED, 'Purchase reference is no longer valid.', 410);
    }
    if (!(new Set<PurchaseReferenceStatus>([
      PurchaseReferenceStatus.ACTIVE,
      PurchaseReferenceStatus.CONSUMED,
    ])).has(stored.status)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_REFERENCE_REPLAYED, 'Purchase reference cannot be used.', 409);
    }
    const order = stored.purchaseRequest.orders[0];
    if (!order) throw new ApiException(ERROR_CODES.COMMERCIAL_ORDER_NOT_FOUND, 'Commercial order was not found.', 404);
    const policy = this.config.getPolicy();
    return {
      publicOrderId: order.publicOrderId,
      product: policy.displayName,
      plan: policy.plan,
      companyName: stored.purchaseRequest.companyName,
      amountMinor: policy.amountMinor,
      currency: policy.currency,
      maxDevices: policy.maxDevices,
      taxPolicy: policy.taxPolicy,
      expiresAt: stored.expiresAt.toISOString(),
      orderState: order.state,
    };
  }

  async createFromOpaqueReference(
    rawReference: string,
    contact: CommercialCheckoutContact,
    now = new Date(),
  ): Promise<CommercialCheckoutResult> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawReference)) throw this.invalidReference();
    const referenceHash = hashPurchaseReference(rawReference);
    const aggregate = await this.prisma.commercialPurchaseReference.findUnique({
      where: { referenceHash },
      include: {
        purchaseRequest: {
          include: {
            customer: true,
            orders: { include: { customer: true, checkoutSessions: { orderBy: { generation: 'desc' } } } },
          },
        },
      },
    });
    if (!aggregate || aggregate.scope !== 'patrolsafe.purchase') throw this.invalidReference();
    if (aggregate.expiresAt <= now || aggregate.purchaseRequest.expiresAt <= now) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_REFERENCE_EXPIRED, 'Purchase reference is no longer valid.', 410);
    }
    if (!(new Set<PurchaseReferenceStatus>([
      PurchaseReferenceStatus.ACTIVE,
      PurchaseReferenceStatus.CONSUMED,
    ])).has(aggregate.status)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_REFERENCE_REPLAYED, 'Purchase reference cannot be used.', 409);
    }

    const request = aggregate.purchaseRequest;
    const order = request.orders[0];
    if (!order) throw new ApiException(ERROR_CODES.COMMERCIAL_ORDER_NOT_FOUND, 'Commercial order was not found.', 404);
    this.assertEligible(request, order, now);

    const existing = order.checkoutSessions.find((session) => session.isActive);
    const replacingExpiredCheckout = Boolean(existing);
    let expiredSnapshot: CommercialCheckoutSnapshot | null = null;
    if (existing) {
      let snapshot: CommercialCheckoutSnapshot;
      try {
        snapshot = await this.provider.retrieveCheckout(existing.providerSessionId);
      } catch {
        await this.auditService.record({
          actorType: 'CUSTOMER',
          action: 'commercial.checkout.provider_failed',
          entityType: 'CommercialOrder',
          entityId: order.id,
          correlationId: randomUUID(),
          metadata: { publicOrderId: order.publicOrderId, provider: 'STRIPE', providerMode: 'TEST', operation: 'retrieve' },
        });
        throw new ApiException(
          ERROR_CODES.COMMERCIAL_CHECKOUT_FAILED,
          'Checkout is temporarily unavailable. No payment was taken.',
          502,
        );
      }
      if (this.isProviderCheckoutActive(snapshot, now)) {
        return this.result(order.publicOrderId, snapshot, true);
      }
      expiredSnapshot = snapshot;
    } else if (aggregate.status === PurchaseReferenceStatus.CONSUMED) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_REFERENCE_REPLAYED, 'Purchase reference has already been used.', 409);
    }

    const customer = order.customer ?? request.customer;
    if (customer && !(new Set<CustomerStatus>([
      CustomerStatus.PROSPECT,
      CustomerStatus.TRIAL,
      CustomerStatus.ACTIVE,
    ])).has(customer.status)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_CHECKOUT_NOT_ALLOWED, 'The customer is not eligible for Checkout.', 409);
    }
    const billingEmail = customer?.billingEmail ?? customer?.email ?? contact.customerEmail?.trim().toLowerCase();
    const contactName = customer?.contactName ?? contact.contactName?.trim() ?? null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_CHECKOUT_NOT_ALLOWED, 'A valid billing email is required.', 409);
    }

    const policy = this.config.getPolicy();
    this.config.assertStripeTestReady();
    const generation = order.checkoutGeneration + 1;
    const correlationId = randomUUID();
    let providerSnapshot: CommercialCheckoutSnapshot;
    try {
      providerSnapshot = await this.provider.createCheckout(Object.freeze({
        commandId: `${COMMERCIAL_CHECKOUT_SCOPE}:${order.id}:${generation}`,
        publicOrderId: order.publicOrderId,
        customerEmail: billingEmail,
        customerName: request.companyName,
        productDisplayName: policy.displayName,
        amountMinor: policy.amountMinor,
        currency: policy.currency,
        successUrl: this.config.renderRedirectUrl(
          this.config.getStripeTestConfig().successUrlTemplate,
          order.publicOrderId,
        ),
        cancelUrl: this.config.renderRedirectUrl(
          this.config.getStripeTestConfig().cancelUrlTemplate,
          order.publicOrderId,
        ),
        metadata: Object.freeze({
          commercial_order_ref: order.publicOrderId,
          commercial_schema: '2',
        }),
      }));
    } catch {
      await this.auditService.record({
        actorType: 'CUSTOMER',
        action: 'commercial.checkout.provider_failed',
        entityType: 'CommercialOrder',
        entityId: order.id,
        correlationId,
        metadata: { publicOrderId: order.publicOrderId, provider: 'STRIPE', providerMode: 'TEST' },
      });
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_CHECKOUT_FAILED,
        'Checkout is temporarily unavailable. No payment was taken.',
        502,
      );
    }
    this.assertProviderSnapshot(providerSnapshot, order.publicOrderId, policy.amountMinor, policy.currency);

    try {
      await this.prisma.$transaction(async (tx) => {
        const currentOrder = await tx.commercialOrder.findUniqueOrThrow({ where: { id: order.id } });
        const currentReference = await tx.commercialPurchaseReference.findUniqueOrThrow({ where: { id: aggregate.id } });
        const sameSession = await tx.commercialCheckoutSession.findUnique({
          where: { providerSessionId: providerSnapshot.providerSessionId },
        });
        if (sameSession) return;
        const referenceAllowsReplacement = replacingExpiredCheckout
          && currentReference.status === PurchaseReferenceStatus.CONSUMED;
        if (currentReference.status !== PurchaseReferenceStatus.ACTIVE && !referenceAllowsReplacement) {
          throw new ApiException(ERROR_CODES.COMMERCIAL_REFERENCE_REPLAYED, 'Purchase reference changed concurrently.', 409);
        }
        if (currentOrder.checkoutGeneration !== order.checkoutGeneration) {
          throw new ApiException(ERROR_CODES.COMMERCIAL_TRANSITION_CONFLICT, 'Checkout changed concurrently.', 409);
        }

        const effectiveCustomer = customer ?? await tx.customer.create({
          data: {
            companyName: request.companyName,
            contactName,
            email: billingEmail,
            billingEmail,
            status: CustomerStatus.PROSPECT,
          },
        });
        await tx.commercialCheckoutSession.updateMany({
          where: { orderId: order.id, isActive: true },
          data: { isActive: false, closedAt: now, status: expiredSnapshot?.status ?? 'replaced' },
        });
        await tx.commercialCheckoutSession.create({
          data: {
            orderId: order.id,
            provider: CommercialProvider.STRIPE,
            providerMode: CommercialProviderMode.TEST,
            providerSessionId: providerSnapshot.providerSessionId,
            providerCustomerId: providerSnapshot.providerCustomerId,
            providerPaymentIntentId: providerSnapshot.paymentIntentId,
            generation,
            status: providerSnapshot.status,
            isActive: true,
            amountMinor: policy.amountMinor,
            currency: policy.currency,
            expiresAt: providerSnapshot.expiresAt,
          },
        });
        await tx.commercialOrder.update({
          where: { id: order.id },
          data: {
            customerId: effectiveCustomer.id,
            state: currentOrder.state === CommercialOrderState.REQUEST_CREATED
              ? CommercialOrderState.CHECKOUT_PENDING
              : currentOrder.state,
            stateVersion: currentOrder.state === CommercialOrderState.REQUEST_CREATED
              ? { increment: 1 }
              : undefined,
            product: policy.product,
            plan: CommercialPlan.ANNUAL,
            amountMinor: policy.amountMinor,
            currency: policy.currency,
            taxPolicy: policy.taxPolicy,
            termsVersion: policy.termsVersion,
            privacyVersion: policy.privacyVersion,
            providerMode: CommercialProviderMode.TEST,
            providerCheckoutSessionId: providerSnapshot.providerSessionId,
            providerPaymentIntentId: providerSnapshot.paymentIntentId,
            providerCustomerId: providerSnapshot.providerCustomerId,
            checkoutStatus: providerSnapshot.status,
            checkoutExpiresAt: providerSnapshot.expiresAt,
            checkoutGeneration: generation,
          },
        });
        if (currentReference.status === PurchaseReferenceStatus.ACTIVE) {
          await tx.commercialPurchaseReference.update({
            where: { id: aggregate.id },
            data: {
              status: PurchaseReferenceStatus.CONSUMED,
              consumedAt: now,
              exchangeCount: { increment: 1 },
            },
          });
        }
        await tx.commercialPurchaseRequest.update({
          where: { id: request.id },
          data: { status: PurchaseRequestStatus.EXCHANGED, exchangedAt: now, customerId: effectiveCustomer.id },
        });
        await createCommercialAudit(tx, this.auditService, {
          actorType: CommercialActorType.CUSTOMER,
          action: generation === 1 ? 'commercial.checkout.created' : 'commercial.checkout.replaced',
          entityType: 'CommercialOrder',
          entityId: order.id,
          customerId: effectiveCustomer.id,
          correlationId,
          metadata: {
            publicOrderId: order.publicOrderId,
            provider: 'STRIPE',
            providerMode: 'TEST',
            generation,
            amountMinor: policy.amountMinor,
            currency: policy.currency,
          },
        });
        if (replacingExpiredCheckout) {
          await createCommercialAudit(tx, this.auditService, {
            actorType: CommercialActorType.SYSTEM,
            action: 'commercial.checkout.expired',
            entityType: 'CommercialOrder',
            entityId: order.id,
            customerId: effectiveCustomer.id,
            correlationId,
            metadata: { provider: 'STRIPE', providerMode: 'TEST', replacementGeneration: generation },
          });
        }
        await createCommercialOutboxEvent(tx, {
          idempotencyKey: `commercial-checkout:${order.id}:generation:${generation}`,
          aggregateType: 'CommercialOrder',
          aggregateId: order.id,
          eventType: 'commercial.checkout.created',
          correlationId,
          payload: { publicOrderId: order.publicOrderId, generation },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const stored = await this.prisma.commercialCheckoutSession.findUnique({
          where: { providerSessionId: providerSnapshot.providerSessionId },
        });
        if (stored) return this.result(order.publicOrderId, providerSnapshot, true);
      }
      throw error;
    }

    return this.result(order.publicOrderId, providerSnapshot, false);
  }

  private assertEligible(
    request: { product: string; plan: CommercialPlan; status: PurchaseRequestStatus; expiresAt: Date },
    order: { product: string; plan: CommercialPlan; state: CommercialOrderState; amountMinor: number | null; currency: string | null },
    now: Date,
  ): void {
    if (request.expiresAt <= now || request.status === PurchaseRequestStatus.EXPIRED || request.status === PurchaseRequestStatus.CANCELLED) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_REQUEST_INVALID, 'Purchase request is expired or cancelled.', 410);
    }
    if (request.product !== COMMERCIAL_PRODUCT || order.product !== COMMERCIAL_PRODUCT) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_REQUEST_INVALID, 'Purchase request product is not supported.', 400);
    }
    if (request.plan !== CommercialPlan.ANNUAL || order.plan !== CommercialPlan.ANNUAL) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_REQUEST_INVALID, 'Purchase request plan is not supported.', 400);
    }
    if (!(new Set<CommercialOrderState>([
      CommercialOrderState.REQUEST_CREATED,
      CommercialOrderState.CHECKOUT_PENDING,
      CommercialOrderState.PAYMENT_PENDING,
    ])).has(order.state)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_CHECKOUT_NOT_ALLOWED, 'Commercial order cannot create Checkout in its current state.', 409);
    }
    const policy = this.config.getPolicy();
    if ((order.amountMinor !== null && order.amountMinor !== policy.amountMinor)
      || (order.currency !== null && order.currency !== COMMERCIAL_CURRENCY)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_RECONCILIATION_MISMATCH, 'Stored order price does not match server policy.', 409);
    }
  }

  private assertProviderSnapshot(snapshot: CommercialCheckoutSnapshot, orderId: string, amount: number, currency: string): void {
    if (snapshot.livemode || snapshot.publicOrderId !== orderId) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_RECONCILIATION_MISMATCH, 'Stripe Checkout identity or mode mismatch.', 409);
    }
    if ((snapshot.amountTotal !== null && snapshot.amountTotal !== amount)
      || (snapshot.currency !== null && snapshot.currency !== currency)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_RECONCILIATION_MISMATCH, 'Stripe Checkout amount or currency mismatch.', 409);
    }
    if (!snapshot.url) throw new ApiException(ERROR_CODES.COMMERCIAL_CHECKOUT_FAILED, 'Checkout redirect URL is unavailable.', 502);
  }

  private isProviderCheckoutActive(snapshot: CommercialCheckoutSnapshot, now: Date): boolean {
    return snapshot.status === 'open' && (!snapshot.expiresAt || snapshot.expiresAt > now) && Boolean(snapshot.url);
  }

  private result(publicOrderId: string, snapshot: CommercialCheckoutSnapshot, duplicate: boolean): CommercialCheckoutResult {
    return {
      publicOrderId,
      checkoutUrl: snapshot.url!,
      providerSessionId: snapshot.providerSessionId,
      expiresAt: snapshot.expiresAt?.toISOString() ?? null,
      status: snapshot.status,
      amountMinor: this.config.getPolicy().amountMinor,
      currency: this.config.getPolicy().currency,
      duplicate,
    };
  }

  private invalidReference(): ApiException {
    return new ApiException(ERROR_CODES.COMMERCIAL_REFERENCE_INVALID, 'Purchase reference is not valid.', 404);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
  }
}
