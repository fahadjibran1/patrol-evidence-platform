import { Injectable, Logger } from '@nestjs/common';
import {
  BillingInterval,
  LicensePlan,
  LicenseStatus,
  LicenceVersionAction,
  CustomerStatus,
} from '@prisma/client';
import type { LicensePayload } from '@patrol/license-core';
import { LICENSE_PAYLOAD_VERSION, todayUtcDate } from '@patrol/license-core';
import { PrismaService } from '@/prisma/prisma.service';
import { SigningService } from '@/signing/signing.service';
import { EncryptionService } from '@/crypto/encryption.service';
import { AuditService } from '@/audit/audit.service';
import { EventBus } from '@/domain-events/event-bus.service';
import { createDomainEvent } from '@/domain-events/domain-event';
import { DOMAIN_EVENTS } from '@/domain-events/domain-event.types';
import { DomainEvent } from '@/domain-events/domain-event';
import { DomainEventHandler } from '@/domain-events/domain-event-handler';
import { PlanFeatureResolver } from '@/billing/shared/plan-feature-resolver';
import { allocateLicenseId, mapPlanToCore } from './licence.util';
import { createVersionAndUpdateCurrent } from './licence-versioning';

const LICENCE_DETAIL_INCLUDE = {
  customer: true,
  currentVersion: true,
} as const;

interface SubscriptionEntitlementPayload {
  subscriptionId: string;
  organisationId: string;
  planId: string;
  maxDevices: number;
  billingInterval: BillingInterval | string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  actorAdminId?: string | null;
  reason?: string | null;
}

/**
 * Licence bounded-context subscriber. Billing never generates TG1 directly —
 * this handler translates subscription domain events into signed licence updates.
 */
@Injectable()
export class LicenceBillingSyncHandler implements DomainEventHandler {
  readonly handles = [
    DOMAIN_EVENTS.SubscriptionActivated,
    DOMAIN_EVENTS.SubscriptionRenewed,
    DOMAIN_EVENTS.PlanChanged,
    DOMAIN_EVENTS.DeviceLimitChanged,
    DOMAIN_EVENTS.SubscriptionCancelled,
    DOMAIN_EVENTS.SubscriptionExpired,
    DOMAIN_EVENTS.SubscriptionSuspended,
  ];

  private readonly logger = new Logger(LicenceBillingSyncHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signingService: SigningService,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBus,
    private readonly planFeatureResolver: PlanFeatureResolver,
  ) {}

  async handle(event: DomainEvent): Promise<void> {
    const payload = event.payload as SubscriptionEntitlementPayload;
    if (!payload?.organisationId) {
      this.logger.warn(`Ignoring ${event.type}: incomplete payload`);
      return;
    }

    try {
      if (
        event.type === DOMAIN_EVENTS.SubscriptionCancelled
        || event.type === DOMAIN_EVENTS.SubscriptionSuspended
      ) {
        await this.applyAccessEnded(payload, LicenseStatus.SUSPENDED, event.type);
        return;
      }
      if (event.type === DOMAIN_EVENTS.SubscriptionExpired) {
        await this.applyAccessEnded(payload, LicenseStatus.EXPIRED, event.type);
        return;
      }
      if (!payload.planId) {
        this.logger.warn(`Ignoring ${event.type}: missing planId`);
        return;
      }
      if (event.type === DOMAIN_EVENTS.DeviceLimitChanged) {
        await this.applyDeviceLimit(payload);
        return;
      }
      if (event.type === DOMAIN_EVENTS.PlanChanged) {
        await this.applyPlanChange(payload);
        return;
      }
      if (event.type === DOMAIN_EVENTS.SubscriptionRenewed) {
        await this.applyRenewal(payload);
        return;
      }
      await this.applyActivation(payload);
    } catch (error) {
      this.logger.error(
        `Licence sync failed for ${event.type}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async applyActivation(payload: SubscriptionEntitlementPayload) {
    const plan = await this.prisma.plan.findUnique({ where: { id: payload.planId } });
    if (!plan) {
      return;
    }
    const customer = await this.prisma.customer.findUnique({ where: { id: payload.organisationId } });
    if (!customer) {
      return;
    }

    const existing = await this.prisma.licence.findFirst({
      where: {
        customerId: customer.id,
        status: { in: [LicenseStatus.ACTIVE, LicenseStatus.SUSPENDED, LicenseStatus.DRAFT] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing && existing.status === LicenseStatus.ACTIVE) {
      await this.applyPlanChange({ ...payload, reason: payload.reason ?? 'subscription.activated' });
      return;
    }

    const adminId = await this.resolveAdminId(payload.actorAdminId);
    const licensePlan = this.toLicensePlan(payload.billingInterval, false);
    const features = this.planFeatureResolver.resolveLicenceFeatures(plan.includedFeatures);
    const startsAt = (payload.currentPeriodStart ?? todayUtcDate()).slice(0, 10);
    const expiresAt = (payload.currentPeriodEnd ?? todayUtcDate()).slice(0, 10);

    if (customer.status === CustomerStatus.PROSPECT || customer.status === CustomerStatus.TRIAL) {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { status: CustomerStatus.ACTIVE },
      });
    }

    const draft = await this.prisma.$transaction(async (tx) => {
      const licenseId = await allocateLicenseId(tx);
      return tx.licence.create({
        data: {
          licenseId,
          customerId: customer.id,
          plan: licensePlan,
          status: LicenseStatus.DRAFT,
          startsAt: new Date(startsAt),
          expiresAt: new Date(expiresAt),
          maxDevices: payload.maxDevices,
          features,
          notes: `Synced from subscription ${payload.subscriptionId}`,
          createdByAdminId: adminId,
        },
      });
    });

    const signedPayload: LicensePayload = {
      version: LICENSE_PAYLOAD_VERSION,
      licenseId: draft.licenseId,
      companyName: customer.companyName,
      customerEmail: customer.email,
      plan: mapPlanToCore(licensePlan),
      issuedAt: todayUtcDate(),
      startsAt,
      expiresAt,
      maxDevices: payload.maxDevices,
      features,
    };
    const signed = this.signingService.signPayload(signedPayload);
    const signedLicenseEnc = this.encryptionService.encrypt(signed.signedLicenseKey);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.licence.update({
        where: { id: draft.id },
        data: {
          status: LicenseStatus.ACTIVE,
          issuedAt: new Date(),
          signedLicenseEnc,
          payloadHash: signed.payloadHash,
          signingKeyId: signed.signingKeyId,
        },
        include: LICENCE_DETAIL_INCLUDE,
      });

      await createVersionAndUpdateCurrent(tx, {
        licenceId: updated.id,
        actionType: LicenceVersionAction.ISSUED,
        plan: updated.plan,
        maxDevices: updated.maxDevices,
        features: updated.features,
        validFrom: startsAt,
        validUntil: expiresAt,
        statusSnapshot: LicenseStatus.ACTIVE,
        issuedByAdminId: adminId,
        signedLicenseEnc,
        payloadHash: signed.payloadHash,
        signingKeyId: signed.signingKeyId,
        producesNewTg1: true,
        reason: 'subscription.activated',
      });
    });

    await this.auditService.record({
      actorAdminId: adminId,
      action: 'licence.issued_from_subscription',
      entityType: 'Licence',
      entityId: draft.id,
      customerId: customer.id,
      licenceId: draft.id,
      metadata: { subscriptionId: payload.subscriptionId, planId: plan.id },
    });

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.LicenceIssued, {
        licenceId: draft.id,
        customerId: customer.id,
        subscriptionId: payload.subscriptionId,
      }),
    );
  }

  private async applyRenewal(payload: SubscriptionEntitlementPayload) {
    const licence = await this.findPrimaryLicence(payload.organisationId);
    if (!licence) {
      await this.applyActivation(payload);
      return;
    }

    const plan = await this.prisma.plan.findUnique({ where: { id: payload.planId } });
    if (!plan) {
      throw new Error(`applyRenewal: plan not found for id ${payload.planId}`);
    }

    const adminId = await this.resolveAdminId(payload.actorAdminId);
    const licensePlan = this.toLicensePlan(payload.billingInterval, false);
    const features = this.planFeatureResolver.resolveLicenceFeatures(plan.includedFeatures);
    const startsAt = (payload.currentPeriodStart ?? todayUtcDate()).slice(0, 10);
    const expiresAt = (payload.currentPeriodEnd ?? todayUtcDate()).slice(0, 10);
    const customer = licence.customer;

    const signedPayload: LicensePayload = {
      version: LICENSE_PAYLOAD_VERSION,
      licenseId: licence.licenseId,
      companyName: customer.companyName,
      customerEmail: customer.email,
      plan: mapPlanToCore(licensePlan),
      issuedAt: todayUtcDate(),
      startsAt,
      expiresAt,
      maxDevices: payload.maxDevices,
      features,
    };
    const signed = this.signingService.signPayload(signedPayload);
    const signedLicenseEnc = this.encryptionService.encrypt(signed.signedLicenseKey);

    await this.prisma.$transaction(async (tx) => {
      await tx.licence.update({
        where: { id: licence.id },
        data: {
          plan: licensePlan,
          status: LicenseStatus.ACTIVE,
          startsAt: new Date(startsAt),
          expiresAt: new Date(expiresAt),
          maxDevices: payload.maxDevices,
          features,
          signedLicenseEnc,
          payloadHash: signed.payloadHash,
          signingKeyId: signed.signingKeyId,
        },
      });
      await createVersionAndUpdateCurrent(tx, {
        licenceId: licence.id,
        actionType: LicenceVersionAction.RENEWED,
        plan: licensePlan,
        maxDevices: payload.maxDevices,
        features,
        validFrom: startsAt,
        validUntil: expiresAt,
        statusSnapshot: LicenseStatus.ACTIVE,
        issuedByAdminId: adminId,
        signedLicenseEnc,
        payloadHash: signed.payloadHash,
        signingKeyId: signed.signingKeyId,
        producesNewTg1: true,
        reason: 'subscription.renewed',
      });
    });

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.LicenceRenewed, {
        licenceId: licence.id,
        customerId: payload.organisationId,
        subscriptionId: payload.subscriptionId,
      }),
    );
  }

  private async applyPlanChange(payload: SubscriptionEntitlementPayload) {
    const licence = await this.findPrimaryLicence(payload.organisationId);
    if (!licence) {
      await this.applyActivation(payload);
      return;
    }
    const plan = await this.prisma.plan.findUnique({ where: { id: payload.planId } });
    if (!plan) {
      throw new Error(`applyPlanChange: plan not found for id ${payload.planId}`);
    }

    const adminId = await this.resolveAdminId(payload.actorAdminId);
    const licensePlan = this.toLicensePlan(payload.billingInterval, false);
    const features = this.planFeatureResolver.resolveLicenceFeatures(plan.includedFeatures);
    const startsAt = (payload.currentPeriodStart ?? licence.startsAt.toISOString()).slice(0, 10);
    const expiresAt = (payload.currentPeriodEnd ?? licence.expiresAt.toISOString()).slice(0, 10);

    const signedPayload: LicensePayload = {
      version: LICENSE_PAYLOAD_VERSION,
      licenseId: licence.licenseId,
      companyName: licence.customer.companyName,
      customerEmail: licence.customer.email,
      plan: mapPlanToCore(licensePlan),
      issuedAt: todayUtcDate(),
      startsAt,
      expiresAt,
      maxDevices: payload.maxDevices,
      features,
    };
    const signed = this.signingService.signPayload(signedPayload);
    const signedLicenseEnc = this.encryptionService.encrypt(signed.signedLicenseKey);

    await this.prisma.$transaction(async (tx) => {
      await tx.licence.update({
        where: { id: licence.id },
        data: {
          plan: licensePlan,
          maxDevices: payload.maxDevices,
          features,
          startsAt: new Date(startsAt),
          expiresAt: new Date(expiresAt),
          signedLicenseEnc,
          payloadHash: signed.payloadHash,
          signingKeyId: signed.signingKeyId,
        },
      });
      await createVersionAndUpdateCurrent(tx, {
        licenceId: licence.id,
        actionType: LicenceVersionAction.PLAN_CHANGED,
        plan: licensePlan,
        maxDevices: payload.maxDevices,
        features,
        validFrom: startsAt,
        validUntil: expiresAt,
        statusSnapshot: licence.status,
        issuedByAdminId: adminId,
        signedLicenseEnc,
        payloadHash: signed.payloadHash,
        signingKeyId: signed.signingKeyId,
        producesNewTg1: true,
        reason: payload.reason ?? 'subscription.plan_changed',
      });
    });
  }

  private async applyDeviceLimit(payload: SubscriptionEntitlementPayload & { previousMaxDevices?: number }) {
    const licence = await this.findPrimaryLicence(payload.organisationId);
    if (!licence) {
      return;
    }
    const adminId = await this.resolveAdminId(payload.actorAdminId);
    const features = (licence.features as string[]) ?? [];
    const startsAt = licence.startsAt.toISOString().slice(0, 10);
    const expiresAt = licence.expiresAt.toISOString().slice(0, 10);

    const signedPayload: LicensePayload = {
      version: LICENSE_PAYLOAD_VERSION,
      licenseId: licence.licenseId,
      companyName: licence.customer.companyName,
      customerEmail: licence.customer.email,
      plan: mapPlanToCore(licence.plan),
      issuedAt: todayUtcDate(),
      startsAt,
      expiresAt,
      maxDevices: payload.maxDevices,
      features,
    };
    const signed = this.signingService.signPayload(signedPayload);
    const signedLicenseEnc = this.encryptionService.encrypt(signed.signedLicenseKey);

    await this.prisma.$transaction(async (tx) => {
      await tx.licence.update({
        where: { id: licence.id },
        data: {
          maxDevices: payload.maxDevices,
          signedLicenseEnc,
          payloadHash: signed.payloadHash,
          signingKeyId: signed.signingKeyId,
        },
      });
      await createVersionAndUpdateCurrent(tx, {
        licenceId: licence.id,
        actionType: LicenceVersionAction.DEVICE_LIMIT_CHANGED,
        plan: licence.plan,
        maxDevices: payload.maxDevices,
        features,
        validFrom: startsAt,
        validUntil: expiresAt,
        statusSnapshot: licence.status,
        issuedByAdminId: adminId,
        signedLicenseEnc,
        payloadHash: signed.payloadHash,
        signingKeyId: signed.signingKeyId,
        producesNewTg1: true,
        reason: 'subscription.device_limit_changed',
      });
    });
  }

  /**
   * RC1 policy: immediate cancel / suspend → SUSPENDED; period end / expired → EXPIRED.
   * Desktop TG1 is offline-crypto; status change is authoritative for portal downloads.
   */
  private async applyAccessEnded(
    payload: SubscriptionEntitlementPayload,
    status: typeof LicenseStatus.SUSPENDED | typeof LicenseStatus.EXPIRED,
    sourceEvent: string,
  ) {
    const licence = await this.findPrimaryLicence(payload.organisationId);
    if (!licence || licence.status === LicenseStatus.REVOKED) {
      this.logger.warn(
        `Access-end (${sourceEvent}) skipped: no eligible licence for org ${payload.organisationId}`,
      );
      return;
    }
    if (licence.status === status) {
      return;
    }

    const adminId = await this.resolveAdminId(payload.actorAdminId);
    // Version action enum has no EXPIRED; SUSPENDED records access-end, statusSnapshot holds policy status.
    const actionType = LicenceVersionAction.SUSPENDED;

    await this.prisma.$transaction(async (tx) => {
      await tx.licence.update({
        where: { id: licence.id },
        data: {
          status,
          ...(status === LicenseStatus.SUSPENDED
            ? {
                suspendedAt: new Date(),
                suspendedByAdminId: adminId,
                suspensionReason: sourceEvent,
              }
            : {
                suspendedAt: new Date(),
                suspendedByAdminId: adminId,
                suspensionReason: sourceEvent,
              }),
        },
      });
      await createVersionAndUpdateCurrent(tx, {
        licenceId: licence.id,
        actionType,
        plan: licence.plan,
        maxDevices: licence.maxDevices,
        features: (licence.features as string[]) ?? [],
        validFrom: licence.startsAt,
        validUntil: licence.expiresAt,
        statusSnapshot: status,
        issuedByAdminId: adminId,
        producesNewTg1: false,
        reason: sourceEvent,
      });
    });

    await this.auditService.record({
      actorAdminId: payload.actorAdminId ?? null,
      action:
        status === LicenseStatus.SUSPENDED ? 'licence.suspended' : 'licence.expired',
      entityType: 'Licence',
      entityId: licence.id,
      customerId: payload.organisationId,
      licenceId: licence.id,
      metadata: { sourceEvent, subscriptionId: payload.subscriptionId },
    });
  }

  private async findPrimaryLicence(organisationId: string) {
    return this.prisma.licence.findFirst({
      where: {
        customerId: organisationId,
        status: { in: [LicenseStatus.ACTIVE, LicenseStatus.SUSPENDED, LicenseStatus.EXPIRED] },
      },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private toLicensePlan(interval: BillingInterval | string, trial: boolean): LicensePlan {
    if (trial) {
      return LicensePlan.TRIAL;
    }
    return interval === BillingInterval.ANNUAL || interval === 'ANNUAL'
      ? LicensePlan.ANNUAL
      : LicensePlan.MONTHLY;
  }

  private async resolveAdminId(actorAdminId?: string | null): Promise<string> {
    if (actorAdminId && actorAdminId !== 'system') {
      const existing = await this.prisma.admin.findUnique({
        where: { id: actorAdminId },
        select: { id: true },
      });
      if (existing) {
        return existing.id;
      }
    }
    const admin = await this.prisma.admin.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) {
      throw new Error('No admin available to attribute billing-driven licence updates');
    }
    return admin.id;
  }
}
