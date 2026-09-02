import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  BillingInterval,
  PlanStatus,
  SubscriptionStatus,
  type Plan,
  type Subscription,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { EventBus } from '@/domain-events/event-bus.service';
import { createDomainEvent } from '@/domain-events/domain-event';
import { DOMAIN_EVENTS } from '@/domain-events/domain-event.types';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { PlansService } from '../plans/plans.service';
import { InvoicesService } from '../invoices/invoices.service';
import { addBillingPeriod } from '../shared/billing.util';
import {
  CancelSubscriptionDto,
  ChangeSubscriptionPlanDto,
  CreateSubscriptionDto,
  ListSubscriptionsQueryDto,
} from './dto/subscription.dto';

const ACTIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.TRIAL,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
];

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBus,
    private readonly plansService: PlansService,
    @Inject(forwardRef(() => InvoicesService))
    private readonly invoicesService: InvoicesService,
  ) {}

  async list(query: ListSubscriptionsQueryDto = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where = {
      ...(query.organisationId ? { organisationId: query.organisationId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        include: { plan: true, organisation: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => this.serialize(row)),
      total,
      page,
      pageSize,
    };
  }

  async getById(id: string) {
    const row = await this.prisma.subscription.findUnique({
      where: { id },
      include: { plan: true, organisation: true },
    });
    if (!row) {
      throw new ApiException(ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 'Subscription not found', 404);
    }
    return this.serialize(row);
  }

  async create(admin: AuthenticatedAdmin, dto: CreateSubscriptionDto) {
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.organisationId } });
    if (!customer) {
      throw new ApiException(ERROR_CODES.CUSTOMER_NOT_FOUND, 'Organisation not found', 404);
    }

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan || plan.status !== PlanStatus.ACTIVE) {
      throw new ApiException(ERROR_CODES.PLAN_NOT_ACTIVE, 'Plan is not active', 400);
    }

    const existing = await this.prisma.subscription.findFirst({
      where: {
        organisationId: dto.organisationId,
        status: { in: ACTIVE_STATUSES },
      },
    });
    if (existing) {
      throw new ApiException(
        ERROR_CODES.SUBSCRIPTION_ALREADY_EXISTS,
        'Organisation already has an active subscription',
        409,
      );
    }

    const interval = dto.billingInterval ?? plan.billingInterval;
    const now = new Date();
    const startTrial = dto.startTrial !== false && plan.trialDays > 0;
    const trialEndsAt = startTrial
      ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
      : null;
    const periodEnd = startTrial ? trialEndsAt! : addBillingPeriod(now, interval);

    const subscription = await this.prisma.subscription.create({
      data: {
        organisationId: dto.organisationId,
        planId: plan.id,
        status: startTrial ? SubscriptionStatus.TRIAL : SubscriptionStatus.ACTIVE,
        billingInterval: interval,
        startedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
        autoRenew: dto.autoRenew ?? true,
        trialEndsAt,
        createdByAdminId: admin.sub,
      },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.subscription_created',
      entityType: 'Subscription',
      entityId: subscription.id,
      customerId: subscription.organisationId,
      metadata: { planId: plan.id, status: subscription.status },
    });

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.SubscriptionCreated, {
        subscriptionId: subscription.id,
        organisationId: subscription.organisationId,
        planId: plan.id,
        status: subscription.status,
        maxDevices: plan.maxDevices,
        billingInterval: subscription.billingInterval,
        currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
        actorAdminId: admin.sub,
      }),
    );

    if (!startTrial) {
      await this.publishActivated(subscription, plan, admin.sub);
      await this.invoicesService.createForSubscription(subscription.id, admin);
    }

    return this.serialize(subscription);
  }

  async activate(admin: AuthenticatedAdmin, id: string) {
    const subscription = await this.requireSubscription(id);
    if (
      subscription.status !== SubscriptionStatus.TRIAL
      && subscription.status !== SubscriptionStatus.SUSPENDED
      && subscription.status !== SubscriptionStatus.PAST_DUE
    ) {
      throw new ApiException(
        ERROR_CODES.SUBSCRIPTION_INVALID_STATE,
        `Cannot activate from ${subscription.status}`,
        400,
      );
    }

    const now = new Date();
    const periodEnd = addBillingPeriod(now, subscription.billingInterval);
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        startedAt: subscription.startedAt ?? now,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
      },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.subscription_activated',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
    });

    await this.publishActivated(updated, updated.plan, admin.sub);
    await this.invoicesService.createForSubscription(id, admin);
    return this.serialize(updated);
  }

  async changePlan(admin: AuthenticatedAdmin, id: string, dto: ChangeSubscriptionPlanDto) {
    const subscription = await this.requireSubscription(id);
    if (!ACTIVE_STATUSES.includes(subscription.status)) {
      throw new ApiException(
        ERROR_CODES.SUBSCRIPTION_INVALID_STATE,
        'Only active subscriptions can change plan',
        400,
      );
    }

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan || plan.status !== PlanStatus.ACTIVE) {
      throw new ApiException(ERROR_CODES.PLAN_NOT_ACTIVE, 'Plan is not active', 400);
    }

    const previousPlanId = subscription.planId;
    const previousMaxDevices = subscription.plan.maxDevices;
    const interval = dto.billingInterval ?? subscription.billingInterval;
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        planId: plan.id,
        billingInterval: interval,
      },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.subscription_plan_changed',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
      metadata: { previousPlanId, planId: plan.id, reason: dto.reason },
    });

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.PlanChanged, {
        subscriptionId: id,
        organisationId: updated.organisationId,
        previousPlanId,
        planId: plan.id,
        maxDevices: plan.maxDevices,
        billingInterval: updated.billingInterval,
        currentPeriodStart: updated.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: updated.currentPeriodEnd?.toISOString() ?? null,
        actorAdminId: admin.sub,
        reason: dto.reason ?? null,
      }),
    );

    if (previousMaxDevices !== plan.maxDevices) {
      await this.eventBus.publish(
        createDomainEvent(DOMAIN_EVENTS.DeviceLimitChanged, {
          subscriptionId: id,
          organisationId: updated.organisationId,
          previousMaxDevices,
          maxDevices: plan.maxDevices,
          actorAdminId: admin.sub,
        }),
      );
    }

    return this.serialize(updated);
  }

  async cancel(admin: AuthenticatedAdmin, id: string, dto: CancelSubscriptionDto = {}) {
    const subscription = await this.requireSubscription(id);
    if (
      subscription.status === SubscriptionStatus.CANCELLED
      || subscription.status === SubscriptionStatus.EXPIRED
    ) {
      throw new ApiException(
        ERROR_CODES.SUBSCRIPTION_INVALID_STATE,
        'Subscription already cancelled or expired',
        400,
      );
    }

    const atPeriodEnd = dto.atPeriodEnd !== false;
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: atPeriodEnd
        ? {
            cancelAtPeriodEnd: true,
            autoRenew: false,
          }
        : {
            status: SubscriptionStatus.CANCELLED,
            cancelAtPeriodEnd: false,
            autoRenew: false,
            cancelledAt: new Date(),
          },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.subscription_cancelled',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
      metadata: { atPeriodEnd, reason: dto.reason },
    });

    if (!atPeriodEnd) {
      await this.eventBus.publish(
        createDomainEvent(DOMAIN_EVENTS.SubscriptionCancelled, {
          subscriptionId: id,
          organisationId: updated.organisationId,
          planId: updated.planId,
          actorAdminId: admin.sub,
        }),
      );
    }

    return this.serialize(updated);
  }

  async resume(admin: AuthenticatedAdmin, id: string) {
    const subscription = await this.requireSubscription(id);
    if (
      subscription.status !== SubscriptionStatus.CANCELLED
      && !subscription.cancelAtPeriodEnd
      && subscription.status !== SubscriptionStatus.SUSPENDED
    ) {
      throw new ApiException(
        ERROR_CODES.SUBSCRIPTION_INVALID_STATE,
        'Subscription cannot be resumed',
        400,
      );
    }

    const now = new Date();
    const periodEnd = addBillingPeriod(now, subscription.billingInterval);
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        autoRenew: true,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
      },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.subscription_resumed',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
    });

    await this.publishActivated(updated, updated.plan, admin.sub);
    return this.serialize(updated);
  }

  async renew(admin: AuthenticatedAdmin, id: string) {
    const subscription = await this.requireSubscription(id);
    if (
      subscription.status !== SubscriptionStatus.ACTIVE
      && subscription.status !== SubscriptionStatus.PAST_DUE
      && subscription.status !== SubscriptionStatus.TRIAL
    ) {
      throw new ApiException(
        ERROR_CODES.SUBSCRIPTION_INVALID_STATE,
        'Subscription cannot be renewed',
        400,
      );
    }

    if (subscription.cancelAtPeriodEnd) {
      return this.expire(admin, id);
    }

    const periodStart = subscription.currentPeriodEnd ?? new Date();
    const periodEnd = addBillingPeriod(periodStart, subscription.billingInterval);
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
        trialEndsAt: null,
      },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.subscription_renewed',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
    });

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.SubscriptionRenewed, {
        subscriptionId: id,
        organisationId: updated.organisationId,
        planId: updated.planId,
        maxDevices: updated.plan.maxDevices,
        billingInterval: updated.billingInterval,
        currentPeriodStart: updated.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: updated.currentPeriodEnd?.toISOString() ?? null,
        actorAdminId: admin.sub,
      }),
    );

    await this.invoicesService.createForSubscription(id, admin);
    return this.serialize(updated);
  }

  /**
   * Provider-driven activation (Stripe webhook). Does not trust browser redirects.
   * Publishes SubscriptionActivated for licence sync.
   */
  async activateFromProvider(
    id: string,
    opts?: { periodStart?: Date; periodEnd?: Date; actorAdminId?: string | null },
  ) {
    const subscription = await this.requireSubscription(id);
    const now = opts?.periodStart ?? new Date();
    const periodEnd =
      opts?.periodEnd ?? addBillingPeriod(now, subscription.billingInterval);
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        pendingCheckout: false,
        startedAt: subscription.startedAt ?? now,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
      },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      actorAdminId: opts?.actorAdminId ?? null,
      action: 'billing.subscription_activated',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
      metadata: { source: 'payment_provider' },
    });

    await this.publishActivated(updated, updated.plan, opts?.actorAdminId ?? 'system');
    return this.serialize(updated);
  }

  async renewFromProvider(
    id: string,
    opts?: { periodStart?: Date; periodEnd?: Date; actorAdminId?: string | null },
  ) {
    await this.applyDueScheduledPlanChange(id);

    const subscription = await this.requireSubscription(id);
    const periodStart = opts?.periodStart ?? subscription.currentPeriodEnd ?? new Date();
    const periodEnd =
      opts?.periodEnd ?? addBillingPeriod(periodStart, subscription.billingInterval);
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        pendingCheckout: false,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextBillingDate: periodEnd,
        trialEndsAt: null,
      },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      actorAdminId: opts?.actorAdminId ?? null,
      action: 'billing.subscription_renewed',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
      metadata: { source: 'payment_provider' },
    });

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.SubscriptionRenewed, {
        subscriptionId: id,
        organisationId: updated.organisationId,
        planId: updated.planId,
        maxDevices: updated.plan.maxDevices,
        billingInterval: updated.billingInterval,
        currentPeriodStart: updated.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: updated.currentPeriodEnd?.toISOString() ?? null,
        actorAdminId: opts?.actorAdminId ?? 'system',
      }),
    );

    return this.serialize(updated);
  }

  /**
   * Apply a customer/admin plan change immediately and publish PlanChanged.
   */
  async applyCustomerPlanChange(
    id: string,
    input: { planId: string; billingInterval: BillingInterval; reason?: string },
  ) {
    const subscription = await this.requireSubscription(id);
    const plan = await this.prisma.plan.findUnique({ where: { id: input.planId } });
    if (!plan || plan.status !== PlanStatus.ACTIVE) {
      throw new ApiException(ERROR_CODES.PLAN_NOT_ACTIVE, 'Plan is not active', 400);
    }
    const previousPlanId = subscription.planId;
    const previousMaxDevices = subscription.plan.maxDevices;
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        planId: plan.id,
        billingInterval: input.billingInterval,
        pendingPlanId: null,
        pendingBillingInterval: null,
        planChangeEffectiveAt: null,
        scheduledChangeType: null,
      },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      action: 'billing.subscription_plan_changed',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
      metadata: { previousPlanId, planId: plan.id, reason: input.reason ?? null },
    });

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.PlanChanged, {
        subscriptionId: id,
        organisationId: updated.organisationId,
        previousPlanId,
        planId: plan.id,
        maxDevices: plan.maxDevices,
        billingInterval: updated.billingInterval,
        currentPeriodStart: updated.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: updated.currentPeriodEnd?.toISOString() ?? null,
        actorAdminId: null,
        reason: input.reason ?? null,
      }),
    );

    if (previousMaxDevices !== plan.maxDevices) {
      await this.eventBus.publish(
        createDomainEvent(DOMAIN_EVENTS.DeviceLimitChanged, {
          subscriptionId: id,
          organisationId: updated.organisationId,
          previousMaxDevices,
          maxDevices: plan.maxDevices,
          actorAdminId: null,
        }),
      );
    }

    return this.serialize(updated);
  }

  async applyDueScheduledPlanChange(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: { plan: true, organisation: true },
    });
    if (
      !subscription?.pendingPlanId
      || subscription.scheduledChangeType !== 'DOWNGRADE'
      || !subscription.planChangeEffectiveAt
      || subscription.planChangeEffectiveAt > new Date()
    ) {
      return null;
    }
    return this.applyCustomerPlanChange(id, {
      planId: subscription.pendingPlanId,
      billingInterval: subscription.pendingBillingInterval ?? subscription.billingInterval,
      reason: 'scheduled_downgrade',
    });
  }

  async cancelFromCustomer(
    id: string,
    dto: { atPeriodEnd: boolean; reason?: string },
  ) {
    await this.requireSubscription(id);
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: dto.atPeriodEnd
        ? {
            cancelAtPeriodEnd: true,
            autoRenew: false,
            cancellationReason: dto.reason ?? null,
          }
        : {
            status: SubscriptionStatus.CANCELLED,
            cancelAtPeriodEnd: false,
            autoRenew: false,
            cancelledAt: new Date(),
            cancellationReason: dto.reason ?? null,
            pendingCheckout: false,
          },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      action: 'billing.subscription_cancelled',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
      metadata: { atPeriodEnd: dto.atPeriodEnd, reason: dto.reason ?? null, source: 'customer' },
    });

    if (!dto.atPeriodEnd) {
      await this.eventBus.publish(
        createDomainEvent(DOMAIN_EVENTS.SubscriptionCancelled, {
          subscriptionId: id,
          organisationId: updated.organisationId,
          planId: updated.planId,
          actorAdminId: 'system',
        }),
      );
    }

    return this.serialize(updated);
  }

  async resumeFromCustomer(id: string) {
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        cancellationReason: null,
        autoRenew: true,
        status: SubscriptionStatus.ACTIVE,
      },
      include: { plan: true, organisation: true },
    });
    await this.auditService.record({
      action: 'billing.subscription_resumed',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
      metadata: { source: 'customer' },
    });
    return this.serialize(updated);
  }

  async markPastDue(id: string, reason?: string) {
    const subscription = await this.requireSubscription(id);
    if (
      subscription.status !== SubscriptionStatus.ACTIVE
      && subscription.status !== SubscriptionStatus.TRIAL
      && subscription.status !== SubscriptionStatus.PAST_DUE
    ) {
      throw new ApiException(
        ERROR_CODES.SUBSCRIPTION_INVALID_STATE,
        'Subscription cannot move to PAST_DUE',
        400,
      );
    }

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { status: SubscriptionStatus.PAST_DUE },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      action: 'billing.subscription_past_due',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
      metadata: { reason },
    });

    return this.serialize(updated);
  }

  async cancelFromProvider(id: string, atPeriodEnd: boolean) {
    await this.requireSubscription(id);
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: atPeriodEnd
        ? { cancelAtPeriodEnd: true, autoRenew: false }
        : {
            status: SubscriptionStatus.CANCELLED,
            cancelAtPeriodEnd: false,
            autoRenew: false,
            cancelledAt: new Date(),
            pendingCheckout: false,
          },
      include: { plan: true, organisation: true },
    });

    if (!atPeriodEnd) {
      await this.eventBus.publish(
        createDomainEvent(DOMAIN_EVENTS.SubscriptionCancelled, {
          subscriptionId: id,
          organisationId: updated.organisationId,
          planId: updated.planId,
          actorAdminId: 'system',
        }),
      );
    }

    return this.serialize(updated);
  }

  async suspend(admin: AuthenticatedAdmin, id: string, reason?: string) {
    const subscription = await this.requireSubscription(id);
    if (!ACTIVE_STATUSES.includes(subscription.status)) {
      throw new ApiException(
        ERROR_CODES.SUBSCRIPTION_INVALID_STATE,
        'Subscription cannot be suspended',
        400,
      );
    }

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { status: SubscriptionStatus.SUSPENDED },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.subscription_suspended',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
      metadata: { reason },
    });

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.SubscriptionSuspended, {
        subscriptionId: id,
        organisationId: updated.organisationId,
        planId: updated.planId,
        actorAdminId: admin.sub,
        reason: reason ?? null,
      }),
    );

    return this.serialize(updated);
  }

  async expire(admin: AuthenticatedAdmin, id: string) {
    const subscription = await this.requireSubscription(id);
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.EXPIRED,
        autoRenew: false,
        cancelAtPeriodEnd: false,
        cancelledAt: subscription.cancelledAt ?? new Date(),
      },
      include: { plan: true, organisation: true },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.subscription_expired',
      entityType: 'Subscription',
      entityId: id,
      customerId: updated.organisationId,
    });

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.SubscriptionExpired, {
        subscriptionId: id,
        organisationId: updated.organisationId,
        planId: updated.planId,
        actorAdminId: admin.sub,
      }),
    );

    return this.serialize(updated);
  }

  private async publishActivated(
    subscription: Subscription & { plan?: Plan },
    plan: Plan,
    actorAdminId: string,
  ) {
    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.SubscriptionActivated, {
        subscriptionId: subscription.id,
        organisationId: subscription.organisationId,
        planId: plan.id,
        maxDevices: plan.maxDevices,
        billingInterval: subscription.billingInterval,
        currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
        actorAdminId,
      }),
    );
  }

  private async requireSubscription(id: string) {
    const row = await this.prisma.subscription.findUnique({
      where: { id },
      include: { plan: true, organisation: true },
    });
    if (!row) {
      throw new ApiException(ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 'Subscription not found', 404);
    }
    return row;
  }

  serialize(
    row: Subscription & {
      plan: Plan;
      organisation?: { id: string; companyName: string; email: string };
    },
  ) {
    return {
      id: row.id,
      organisationId: row.organisationId,
      organisationName: row.organisation?.companyName ?? null,
      organisationEmail: row.organisation?.email ?? null,
      planId: row.planId,
      plan: this.plansService.serialize(row.plan),
      status: row.status,
      pendingCheckout: row.pendingCheckout,
      billingInterval: row.billingInterval,
      startedAt: row.startedAt?.toISOString() ?? null,
      currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      nextBillingDate: row.nextBillingDate?.toISOString() ?? null,
      autoRenew: row.autoRenew,
      trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancellationReason: (row as { cancellationReason?: string | null }).cancellationReason ?? null,
      pendingPlanId: (row as { pendingPlanId?: string | null }).pendingPlanId ?? null,
      scheduledChangeType: (row as { scheduledChangeType?: string | null }).scheduledChangeType ?? null,
      planChangeEffectiveAt:
        (row as { planChangeEffectiveAt?: Date | null }).planChangeEffectiveAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
