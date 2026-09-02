import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AdminRole,
  CustomerStatus,
  LicenceVersionAction,
  LicensePlan,
  LicenseStatus,
  NotificationType,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { EventBus } from '@/domain-events/event-bus.service';
import { createDomainEvent } from '@/domain-events/domain-event';
import { DOMAIN_EVENTS } from '@/domain-events/domain-event.types';
import { MetricsService } from '@/metrics/metrics.service';
import {
  LICENSE_PAYLOAD_VERSION,
  todayUtcDate,
  type LicensePayload,
} from '@patrol/license-core';
import { PrismaService } from '@/prisma/prisma.service';
import { SigningService } from '@/signing/signing.service';
import { EncryptionService } from '@/crypto/encryption.service';
import { AuditService } from '@/audit/audit.service';
import { AuthService } from '@/auth/auth.service';
import { NotificationService } from '@/notifications/notifications.service';
import { EmailProvider } from '@/notifications/providers/email.provider';
import {
  buildDefaultLicenceIssuedSubject,
  buildLicenceActivationInstructions,
  renderLicenceIssuedTemplate,
} from '@/notifications/templates/licence-issued.template';
import { renderLicenceRenewedTemplate } from '@/notifications/templates/licence-renewed.template';
import { renderLicenceReissuedTemplate } from '@/notifications/templates/licence-reissued.template';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import {
  allocateLicenseId,
  computeExpiresAt,
  computeRenewalWindow,
  deriveEffectiveStatus,
  mapPlanToCore,
  maskStoredLicenceKey,
  toDateOnly,
} from './licence.util';
import {
  hasRequiredLicenceFeatures,
  normalizeLicenceFeatures,
  REQUIRED_LICENCE_FEATURES,
  SUPPORTED_LICENCE_FEATURES,
} from './licence-features';
import { createVersionAndUpdateCurrent } from './licence-versioning';
import { CreateDraftLicenceDto, IssueLicenceDto, RevealLicenceDto } from './dto/licence.dto';
import { IssueExistingLicenceDto } from './dto/licence-actions.dto';
import {
  ChangeDeviceLimitDto,
  ChangePlanDto,
  ReactivateLicenceDto,
  ReissueLicenceDto,
  RenewLicenceLifecycleDto,
  RevokeLicenceLifecycleDto,
  SuspendLicenceLifecycleDto,
} from './dto/lifecycle.dto';
import { CreateInstallationDto, UpdateInstallationDto } from './dto/installation.dto';
import { EmailLicenceDto } from './dto/email-licence.dto';

const LICENCE_FILE_MIME = 'text/plain; charset=utf-8';

/** Minimal shape shared by every lifecycle mutation result that can be emailed. */
interface LicenceForEmailAttachment {
  id: string;
  licenseId: string;
  plan: LicensePlan;
  maxDevices: number;
  features: unknown;
  startsAt: Date;
  expiresAt: Date;
  notes?: string | null;
  customerId: string;
  customer?: { companyName: string; email: string; contactName?: string | null } | null;
}

export interface EmailLifecycleAttachmentResult {
  success: boolean;
  recipient?: string;
  notificationLogId?: string;
  errorCode?: string;
  errorMessage?: string;
}

const LICENCE_DETAIL_INCLUDE = {
  customer: true,
  installations: true,
  payments: true,
  renewals: true,
  previousLicence: true,
} as const;

@Injectable()
export class LicencesService {
  private readonly logger = new Logger(LicencesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signingService: SigningService,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
    private readonly notificationService: NotificationService,
    private readonly emailProvider: EmailProvider,
    @Optional() private readonly eventBus?: EventBus,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  async list(query: {
    page: number;
    pageSize: number;
    status?: LicenseStatus;
    customerId?: string;
    search?: string;
  }) {
    const where: Prisma.LicenceWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.customerId) {
      where.customerId = query.customerId;
    }
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { licenseId: { contains: term, mode: 'insensitive' } },
        { customer: { companyName: { contains: term, mode: 'insensitive' } } },
        { customer: { email: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.licence.count({ where }),
      this.prisma.licence.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: { customer: true },
      }),
    ]);

    return {
      total,
      items: items.map((item) => this.toListResponse(item)),
    };
  }

  async findOne(id: string) {
    const licence = await this.getLicenceOrThrow(id);
    const detail = this.toDetailResponse(licence);
    const [auditLogs, notificationLogs, versions] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { licenceId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { actor: { select: { displayName: true, email: true } } },
      }),
      this.notificationService.listForLicence(id),
      this.prisma.licenceVersion.findMany({
        where: { licenceId: id },
        orderBy: { versionNumber: 'desc' },
        include: { issuedBy: { select: { displayName: true, email: true } } },
      }),
    ]);

    return {
      ...detail,
      auditLogs: auditLogs.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        customerId: entry.customerId,
        licenceId: entry.licenceId,
        metadata: entry.metadata,
        createdAt: entry.createdAt.toISOString(),
        actorDisplayName: entry.actor?.displayName ?? null,
      })),
      notificationLogs,
      versions: versions.map((version) => ({
        id: version.id,
        versionNumber: version.versionNumber,
        actionType: version.actionType,
        plan: version.plan,
        maxDevices: version.maxDevices,
        features: version.features,
        validFrom: toDateOnly(version.validFrom),
        validUntil: toDateOnly(version.validUntil),
        statusSnapshot: version.statusSnapshot,
        hasSignedLicence: Boolean(version.signedLicenseEnc),
        reason: version.reason,
        previousVersionId: version.previousVersionId,
        createdAt: version.createdAt.toISOString(),
        issuedByDisplayName: version.issuedBy?.displayName ?? null,
        isCurrent: licence.currentVersionId === version.id,
      })),
    };
  }

  async createDraft(admin: AuthenticatedAdmin, dto: CreateDraftLicenceDto) {
    this.assertCanIssue(admin.role);
    await this.ensureCustomerEligible(dto.customerId);
    const features = this.normalizeAndValidateFeatures(dto.features);

    const startsAt = dto.startsAt ?? todayUtcDate();
    const expiresAt = computeExpiresAt(startsAt, dto.plan, dto.expiresAt);

    if (startsAt > expiresAt) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_DATE_RANGE, 'startsAt must be on or before expiresAt', 400);
    }

    const licence = await this.prisma.$transaction(async (tx) => {
      const licenseId = await allocateLicenseId(tx);
      return tx.licence.create({
        data: {
          licenseId,
          customerId: dto.customerId,
          plan: dto.plan,
          status: LicenseStatus.DRAFT,
          startsAt: new Date(startsAt),
          expiresAt: new Date(expiresAt),
          maxDevices: dto.maxDevices,
          features,
          notes: dto.notes,
          createdByAdminId: admin.sub,
        },
        include: { customer: true },
      });
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.draft_created',
      entityType: 'Licence',
      entityId: licence.id,
      customerId: licence.customerId,
      licenceId: licence.id,
      metadata: { licenseId: licence.licenseId, plan: licence.plan },
    });

    return this.toDetailResponse(licence);
  }

  async issueImmediately(admin: AuthenticatedAdmin, dto: IssueLicenceDto) {
    this.assertCanIssue(admin.role);
    const customer = await this.ensureCustomerEligible(dto.customerId);
    const features = this.normalizeAndValidateFeatures(dto.features);
    this.validatePaymentFields(dto);

    const startsAt = dto.startsAt ?? todayUtcDate();
    const expiresAt = computeExpiresAt(startsAt, dto.plan, dto.expiresAt);
    if (startsAt > expiresAt) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_DATE_RANGE, 'startsAt must be on or before expiresAt', 400);
    }

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.issue.started',
      entityType: 'Customer',
      entityId: customer.id,
      customerId: customer.id,
      metadata: { plan: dto.plan, maxDevices: dto.maxDevices },
    });

    try {
      const draft = await this.prisma.$transaction(async (tx) => {
        const licenseId = await allocateLicenseId(tx);
        return tx.licence.create({
          data: {
            licenseId,
            customerId: dto.customerId,
            plan: dto.plan,
            status: LicenseStatus.DRAFT,
            startsAt: new Date(startsAt),
            expiresAt: new Date(expiresAt),
            maxDevices: dto.maxDevices,
            features,
            notes: dto.notes,
            createdByAdminId: admin.sub,
          },
          include: { customer: true },
        });
      });

      await this.auditService.record({
        actorAdminId: admin.sub,
        action: 'licence.draft_created',
        entityType: 'Licence',
        entityId: draft.id,
        customerId: draft.customerId,
        licenceId: draft.id,
        metadata: { licenseId: draft.licenseId, plan: draft.plan },
      });

      const payload: LicensePayload = {
        version: LICENSE_PAYLOAD_VERSION,
        licenseId: draft.licenseId,
        companyName: customer.companyName,
        customerEmail: dto.customerEmail ?? customer.email,
        plan: mapPlanToCore(dto.plan),
        issuedAt: todayUtcDate(),
        startsAt,
        expiresAt,
        maxDevices: dto.maxDevices,
        features,
        notes: dto.notes ?? undefined,
      };

      const signed = this.signingService.signPayload(payload);
      const signedLicenseEnc = this.encryptionService.encrypt(signed.signedLicenseKey);

      const { updated, payment } = await this.prisma.$transaction(async (tx) => {
        const updatedLicence = await tx.licence.update({
          where: { id: draft.id },
          data: {
            status: LicenseStatus.ACTIVE,
            issuedAt: new Date(),
            startsAt: new Date(startsAt),
            expiresAt: new Date(expiresAt),
            maxDevices: payload.maxDevices,
            features: payload.features,
            notes: payload.notes,
            signedLicenseEnc,
            payloadHash: signed.payloadHash,
            signingKeyId: signed.signingKeyId,
          },
          include: LICENCE_DETAIL_INCLUDE,
        });

        await createVersionAndUpdateCurrent(tx, {
          licenceId: updatedLicence.id,
          actionType: LicenceVersionAction.ISSUED,
          plan: updatedLicence.plan,
          maxDevices: updatedLicence.maxDevices,
          features: updatedLicence.features,
          validFrom: startsAt,
          validUntil: expiresAt,
          statusSnapshot: LicenseStatus.ACTIVE,
          issuedByAdminId: admin.sub,
          signedLicenseEnc,
          payloadHash: signed.payloadHash,
          signingKeyId: signed.signingKeyId,
          producesNewTg1: true,
        });

        let paymentRecord = null;
        if (dto.paymentStatus || dto.amountPence !== undefined || dto.paymentReference || dto.invoiceReference) {
          paymentRecord = await tx.paymentRecord.create({
            data: {
              customerId: customer.id,
              licenceId: updatedLicence.id,
              amountPence: dto.amountPence ?? 0,
              currency: dto.currency ?? 'GBP',
              paymentStatus: dto.paymentStatus ?? PaymentStatus.PENDING,
              paymentMethod: dto.paymentMethod,
              paymentReference: dto.paymentReference,
              invoiceReference: dto.invoiceReference,
              paidAt: dto.paymentStatus === PaymentStatus.PAID ? new Date() : null,
              periodStart: new Date(startsAt),
              periodEnd: new Date(expiresAt),
              notes: dto.notes,
              recordedByAdminId: admin.sub,
            },
          });
        }

        return { updated: updatedLicence, payment: paymentRecord };
      });

      await this.auditService.record({
        actorAdminId: admin.sub,
        action: 'licence.issued',
        entityType: 'Licence',
        entityId: updated.id,
        customerId: updated.customerId,
        licenceId: updated.id,
        metadata: { licenseId: updated.licenseId, plan: updated.plan, signingKeyId: updated.signingKeyId },
      });
      this.metricsService?.increment('licenceIssues');
      await this.eventBus?.publish(
        createDomainEvent(DOMAIN_EVENTS.LicenceIssued, {
          licenceId: updated.id,
          licenseId: updated.licenseId,
          customerId: updated.customerId,
          plan: updated.plan,
        }),
      );

      if (payment) {
        await this.auditService.record({
          actorAdminId: admin.sub,
          action: 'payment.recorded',
          entityType: 'PaymentRecord',
          entityId: payment.id,
          customerId: payment.customerId,
          licenceId: payment.licenceId ?? undefined,
          metadata: {
            amountPence: payment.amountPence,
            paymentStatus: payment.paymentStatus,
            paymentReference: payment.paymentReference,
          },
        });
        await this.eventBus?.publish(
          createDomainEvent(DOMAIN_EVENTS.PaymentRecorded, {
            paymentId: payment.id,
            customerId: payment.customerId,
            licenceId: payment.licenceId,
            amountPence: payment.amountPence,
          }),
        );
      }

      const licence = this.toDetailResponse(updated);
      return {
        licence,
        fullLicenseKey: signed.signedLicenseKey,
        // Backward-compatible aliases for existing portal clients.
        signedLicenseKey: signed.signedLicenseKey,
        licenseKey: signed.signedLicenseKey,
        ...licence,
      };
    } catch (error) {
      await this.auditService.record({
        actorAdminId: admin.sub,
        action: 'licence.issue.failed',
        entityType: 'Customer',
        entityId: customer.id,
        customerId: customer.id,
        metadata: {
          plan: dto.plan,
          reason: error instanceof ApiException ? error.code : 'LICENCE_ISSUE_FAILED',
        },
      });
      throw error;
    }
  }

  async issueExisting(admin: AuthenticatedAdmin, id: string, dto: Partial<IssueLicenceDto> & IssueExistingLicenceDto) {
    this.assertCanIssue(admin.role);
    const licence = await this.getLicenceOrThrow(id);

    if (licence.status !== LicenseStatus.DRAFT) {
      throw new ApiException(ERROR_CODES.LICENCE_ALREADY_ISSUED, 'Licence has already been issued', 409);
    }

    const customer = await this.ensureCustomerEligible(licence.customerId);
    const startsAt = dto.startsAt ?? toDateOnly(licence.startsAt);
    const expiresAt = dto.expiresAt ?? toDateOnly(licence.expiresAt);
    const features = this.normalizeAndValidateFeatures(
      (dto.features ?? (licence.features as string[])) as string[],
    );

    if (startsAt > expiresAt) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_DATE_RANGE, 'startsAt must be on or before expiresAt', 400);
    }

    const payload: LicensePayload = {
      version: LICENSE_PAYLOAD_VERSION,
      licenseId: licence.licenseId,
      companyName: customer.companyName,
      customerEmail: dto.customerEmail ?? customer.email,
      plan: mapPlanToCore(licence.plan),
      issuedAt: todayUtcDate(),
      startsAt,
      expiresAt,
      maxDevices: dto.maxDevices ?? licence.maxDevices,
      features,
      notes: dto.notes ?? licence.notes ?? undefined,
    };

    const signed = this.signingService.signPayload(payload);
    const signedLicenseEnc = this.encryptionService.encrypt(signed.signedLicenseKey);

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedLicence = await tx.licence.update({
        where: { id: licence.id },
        data: {
          status: LicenseStatus.ACTIVE,
          issuedAt: new Date(),
          startsAt: new Date(startsAt),
          expiresAt: new Date(expiresAt),
          maxDevices: payload.maxDevices,
          features: payload.features,
          notes: payload.notes,
          signedLicenseEnc,
          payloadHash: signed.payloadHash,
          signingKeyId: signed.signingKeyId,
        },
        include: LICENCE_DETAIL_INCLUDE,
      });

      await createVersionAndUpdateCurrent(tx, {
        licenceId: updatedLicence.id,
        actionType: LicenceVersionAction.ISSUED,
        plan: updatedLicence.plan,
        maxDevices: updatedLicence.maxDevices,
        features: updatedLicence.features,
        validFrom: startsAt,
        validUntil: expiresAt,
        statusSnapshot: LicenseStatus.ACTIVE,
        issuedByAdminId: admin.sub,
        signedLicenseEnc,
        payloadHash: signed.payloadHash,
        signingKeyId: signed.signingKeyId,
        producesNewTg1: true,
      });

      return updatedLicence;
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.issued',
      entityType: 'Licence',
      entityId: updated.id,
      customerId: updated.customerId,
      licenceId: updated.id,
      metadata: { licenseId: updated.licenseId, plan: updated.plan },
    });
    this.metricsService?.increment('licenceIssues');
    await this.eventBus?.publish(
      createDomainEvent(DOMAIN_EVENTS.LicenceIssued, {
        licenceId: updated.id,
        licenseId: updated.licenseId,
        customerId: updated.customerId,
        plan: updated.plan,
      }),
    );

    const detail = this.toDetailResponse(updated);
    return {
      licence: detail,
      fullLicenseKey: signed.signedLicenseKey,
      signedLicenseKey: signed.signedLicenseKey,
      licenseKey: signed.signedLicenseKey,
      ...detail,
    };
  }

  /**
   * Renews a licence in place: the commercial licence ID never changes. A new signed TG1
   * is produced covering the new validity window and a RENEWED LicenceVersion is recorded.
   * Email delivery failures never roll back the renewal.
   */
  async renew(admin: AuthenticatedAdmin, id: string, dto: RenewLicenceLifecycleDto) {
    this.assertCanLifecycle(admin.role);
    const licence = await this.getLicenceOrThrow(id);
    this.assertNotRevoked(licence);
    await this.assertPassword(admin, dto.password);

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.renewal.requested',
      entityType: 'Licence',
      entityId: id,
      customerId: licence.customerId,
      licenceId: id,
      metadata: { renewalPeriod: dto.renewalPeriod },
    });

    let updated: Prisma.LicenceGetPayload<{ include: typeof LICENCE_DETAIL_INCLUDE }>;
    let versionNumber: number;
    let validFrom: string;
    let validUntil: string;
    let signedLicenseKey: string;

    try {
      if (licence.status === LicenseStatus.DRAFT) {
        throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Draft licences must be issued, not renewed', 400);
      }

      const customer = await this.ensureCustomer(licence.customerId);
      const today = todayUtcDate();
      const sourceExpiresAt = toDateOnly(licence.expiresAt);
      const expectedContinuityFrom =
        sourceExpiresAt >= today ? addDaysUtc(sourceExpiresAt, 1) : today;

      if (dto.renewalPeriod === 'CUSTOM') {
        if (!dto.validFrom || !dto.validUntil) {
          throw new ApiException(
            ERROR_CODES.LICENCE_RENEWAL_DATE_INVALID,
            'validFrom and validUntil are required for CUSTOM renewal',
            400,
          );
        }
        validFrom = dto.validFrom;
        validUntil = dto.validUntil;
      } else {
        const window = computeRenewalWindow({
          renewalPeriod: dto.renewalPeriod,
          sourceExpiresAt,
          today,
          validFrom: dto.validFrom,
        });
        validFrom = window.validFrom;
        validUntil = window.validUntil;
      }

      if (validFrom > validUntil) {
        throw new ApiException(ERROR_CODES.LICENCE_RENEWAL_DATE_INVALID, 'validFrom must be on or before validUntil', 400);
      }

      const isSuperAdminOverride = dto.allowDateOverride === true && admin.role === AdminRole.SUPER_ADMIN;
      if (!isSuperAdminOverride && validFrom !== expectedContinuityFrom) {
        throw new ApiException(
          ERROR_CODES.LICENCE_RENEWAL_DATE_INVALID,
          `validFrom must continue from the current expiry (expected ${expectedContinuityFrom}); only SUPER_ADMIN with allowDateOverride may create a gap or overlap`,
          400,
        );
      }

      const plan = dto.plan ?? licence.plan;
      const maxDevices = dto.maxDevices ?? licence.maxDevices;
      const features = (licence.features as string[]) ?? [];

      const payload: LicensePayload = {
        version: LICENSE_PAYLOAD_VERSION,
        licenseId: licence.licenseId,
        companyName: customer.companyName,
        customerEmail: customer.email,
        plan: mapPlanToCore(plan),
        issuedAt: todayUtcDate(),
        startsAt: validFrom,
        expiresAt: validUntil,
        maxDevices,
        features,
        notes: licence.notes ?? undefined,
      };

      const signed = this.signingService.signPayload(payload);
      const signedLicenseEnc = this.encryptionService.encrypt(signed.signedLicenseKey);
      signedLicenseKey = signed.signedLicenseKey;

      const result = await this.prisma.$transaction(async (tx) => {
        const updatedLicence = await tx.licence.update({
          where: { id: licence.id },
          data: {
            status: LicenseStatus.ACTIVE,
            plan,
            maxDevices,
            startsAt: new Date(validFrom),
            expiresAt: new Date(validUntil),
            signedLicenseEnc,
            payloadHash: signed.payloadHash,
            signingKeyId: signed.signingKeyId,
          },
          include: LICENCE_DETAIL_INCLUDE,
        });

        const version = await createVersionAndUpdateCurrent(tx, {
          licenceId: licence.id,
          actionType: LicenceVersionAction.RENEWED,
          plan,
          maxDevices,
          features,
          validFrom,
          validUntil,
          statusSnapshot: LicenseStatus.ACTIVE,
          issuedByAdminId: admin.sub,
          signedLicenseEnc,
          payloadHash: signed.payloadHash,
          signingKeyId: signed.signingKeyId,
          producesNewTg1: true,
          reason: dto.reason ?? null,
        });

        return { updated: updatedLicence, version };
      });

      updated = result.updated;
      versionNumber = result.version.versionNumber;
    } catch (error) {
      await this.auditService.record({
        actorAdminId: admin.sub,
        action: 'licence.renewal.failed',
        entityType: 'Licence',
        entityId: id,
        customerId: licence.customerId,
        licenceId: id,
        metadata: { reason: error instanceof ApiException ? error.code : 'LICENCE_RENEWAL_FAILED' },
      });
      throw error;
    }

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.renewed',
      entityType: 'Licence',
      entityId: id,
      customerId: updated.customerId,
      licenceId: id,
      metadata: {
        licenseId: updated.licenseId,
        renewalPeriod: dto.renewalPeriod,
        validFrom,
        validUntil,
        versionNumber,
      },
    });
    this.metricsService?.increment('renewals');
    await this.eventBus?.publish(
      createDomainEvent(DOMAIN_EVENTS.LicenceRenewed, {
        licenceId: id,
        licenseId: updated.licenseId,
        customerId: updated.customerId,
        renewalPeriod: dto.renewalPeriod,
        validFrom,
        validUntil,
      }),
    );

    let emailResult: EmailLifecycleAttachmentResult | undefined;
    if (dto.emailAfterRenewal) {
      emailResult = await this.emailCurrentLicenceAttachment(admin, updated, {
        notificationType: NotificationType.LICENSE_RENEWED,
        recipientEmail: dto.recipientEmail,
        fullLicenseKey: signedLicenseKey,
      });
    }

    return {
      ...this.toDetailResponse(updated),
      fullLicenseKey: signedLicenseKey,
      signedLicenseKey,
      emailResult,
    };
  }

  /** Re-signs the current entitlement (same plan/dates/devices/features) with a fresh TG1. */
  async reissue(admin: AuthenticatedAdmin, id: string, dto: ReissueLicenceDto) {
    this.assertCanLifecycle(admin.role);
    const licence = await this.getLicenceOrThrow(id);
    this.assertNotRevoked(licence);
    await this.assertPassword(admin, dto.password);

    if (licence.status === LicenseStatus.DRAFT) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Draft licences must be issued, not reissued', 400);
    }
    if (!licence.signedLicenseEnc) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Licence has not been issued yet', 400);
    }

    const customer = await this.ensureCustomer(licence.customerId);
    const startsAt = toDateOnly(licence.startsAt);
    const expiresAt = toDateOnly(licence.expiresAt);
    const features = (licence.features as string[]) ?? [];

    const payload: LicensePayload = {
      version: LICENSE_PAYLOAD_VERSION,
      licenseId: licence.licenseId,
      companyName: customer.companyName,
      customerEmail: customer.email,
      plan: mapPlanToCore(licence.plan),
      issuedAt: todayUtcDate(),
      startsAt,
      expiresAt,
      maxDevices: licence.maxDevices,
      features,
      notes: licence.notes ?? undefined,
    };

    const signed = this.signingService.signPayload(payload);
    const signedLicenseEnc = this.encryptionService.encrypt(signed.signedLicenseKey);

    const { updated, version } = await this.prisma.$transaction(async (tx) => {
      const updatedLicence = await tx.licence.update({
        where: { id },
        data: {
          signedLicenseEnc,
          payloadHash: signed.payloadHash,
          signingKeyId: signed.signingKeyId,
        },
        include: LICENCE_DETAIL_INCLUDE,
      });

      const version = await createVersionAndUpdateCurrent(tx, {
        licenceId: id,
        actionType: LicenceVersionAction.REISSUED,
        plan: updatedLicence.plan,
        maxDevices: updatedLicence.maxDevices,
        features: updatedLicence.features,
        validFrom: startsAt,
        validUntil: expiresAt,
        statusSnapshot: updatedLicence.status,
        issuedByAdminId: admin.sub,
        signedLicenseEnc,
        payloadHash: signed.payloadHash,
        signingKeyId: signed.signingKeyId,
        producesNewTg1: true,
        reason: dto.reason,
      });

      return { updated: updatedLicence, version };
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.reissued',
      entityType: 'Licence',
      entityId: id,
      customerId: updated.customerId,
      licenceId: id,
      metadata: { licenseId: updated.licenseId, reason: dto.reason, versionNumber: version.versionNumber },
    });
    await this.eventBus?.publish(
      createDomainEvent(DOMAIN_EVENTS.LicenceReissued, {
        licenceId: id,
        licenseId: updated.licenseId,
        customerId: updated.customerId,
        reason: dto.reason,
      }),
    );

    let emailResult: EmailLifecycleAttachmentResult | undefined;
    if (dto.emailAfterReissue) {
      emailResult = await this.emailCurrentLicenceAttachment(admin, updated, {
        notificationType: NotificationType.LICENSE_REISSUED,
        recipientEmail: dto.recipientEmail,
        fullLicenseKey: signed.signedLicenseKey,
      });
    }

    return {
      ...this.toDetailResponse(updated),
      fullLicenseKey: signed.signedLicenseKey,
      signedLicenseKey: signed.signedLicenseKey,
      emailResult,
    };
  }

  /** Changes the commercial plan tier without altering the current validity window. */
  async changePlan(admin: AuthenticatedAdmin, id: string, dto: ChangePlanDto) {
    this.assertCanLifecycle(admin.role);
    const licence = await this.getLicenceOrThrow(id);
    this.assertNotRevoked(licence);
    await this.assertPassword(admin, dto.password);

    if (licence.status === LicenseStatus.DRAFT) {
      throw new ApiException(
        ERROR_CODES.LICENCE_INVALID_STATUS_TRANSITION,
        'Draft licences must be issued before changing plan',
        400,
      );
    }

    const customer = await this.ensureCustomer(licence.customerId);
    const validFrom = dto.validFrom ?? toDateOnly(licence.startsAt);
    const validUntil = toDateOnly(licence.expiresAt);

    if (validFrom > validUntil) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_DATE_RANGE, 'validFrom must be on or before the current expiry', 400);
    }

    const features = (licence.features as string[]) ?? [];

    const payload: LicensePayload = {
      version: LICENSE_PAYLOAD_VERSION,
      licenseId: licence.licenseId,
      companyName: customer.companyName,
      customerEmail: customer.email,
      plan: mapPlanToCore(dto.newPlan),
      issuedAt: todayUtcDate(),
      startsAt: validFrom,
      expiresAt: validUntil,
      maxDevices: licence.maxDevices,
      features,
      notes: licence.notes ?? undefined,
    };

    const signed = this.signingService.signPayload(payload);
    const signedLicenseEnc = this.encryptionService.encrypt(signed.signedLicenseKey);

    const { updated, version } = await this.prisma.$transaction(async (tx) => {
      const updatedLicence = await tx.licence.update({
        where: { id },
        data: {
          plan: dto.newPlan,
          startsAt: new Date(validFrom),
          expiresAt: new Date(validUntil),
          signedLicenseEnc,
          payloadHash: signed.payloadHash,
          signingKeyId: signed.signingKeyId,
        },
        include: LICENCE_DETAIL_INCLUDE,
      });

      const version = await createVersionAndUpdateCurrent(tx, {
        licenceId: id,
        actionType: LicenceVersionAction.PLAN_CHANGED,
        plan: dto.newPlan,
        maxDevices: updatedLicence.maxDevices,
        features: updatedLicence.features,
        validFrom,
        validUntil,
        statusSnapshot: updatedLicence.status,
        issuedByAdminId: admin.sub,
        signedLicenseEnc,
        payloadHash: signed.payloadHash,
        signingKeyId: signed.signingKeyId,
        producesNewTg1: true,
        reason: dto.reason,
      });

      return { updated: updatedLicence, version };
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.plan_changed',
      entityType: 'Licence',
      entityId: id,
      customerId: updated.customerId,
      licenceId: id,
      metadata: {
        licenseId: updated.licenseId,
        newPlan: dto.newPlan,
        reason: dto.reason,
        versionNumber: version.versionNumber,
      },
    });

    let emailResult: EmailLifecycleAttachmentResult | undefined;
    if (dto.emailUpdatedLicence) {
      emailResult = await this.emailCurrentLicenceAttachment(admin, updated, {
        notificationType: NotificationType.LICENSE_REISSUED,
        recipientEmail: dto.recipientEmail,
        fullLicenseKey: signed.signedLicenseKey,
      });
    }

    return {
      ...this.toDetailResponse(updated),
      fullLicenseKey: signed.signedLicenseKey,
      signedLicenseKey: signed.signedLicenseKey,
      emailResult,
    };
  }

  /** Changes the maximum device count, refusing to drop below devices already registered. */
  async changeDeviceLimit(admin: AuthenticatedAdmin, id: string, dto: ChangeDeviceLimitDto) {
    this.assertCanLifecycle(admin.role);
    const licence = await this.getLicenceOrThrow(id);
    this.assertNotRevoked(licence);
    await this.assertPassword(admin, dto.password);

    if (licence.status === LicenseStatus.DRAFT) {
      throw new ApiException(
        ERROR_CODES.LICENCE_INVALID_STATUS_TRANSITION,
        'Draft licences must be issued before changing device limits',
        400,
      );
    }

    const activeInstallCount = await this.prisma.installation.count({
      where: { licenceId: id, status: { in: ['PENDING', 'ACTIVE'] } },
    });
    if (dto.maxDevices < activeInstallCount) {
      throw new ApiException(
        ERROR_CODES.LICENCE_DEVICE_LIMIT_INVALID,
        `maxDevices cannot be lower than the ${activeInstallCount} device(s) currently registered`,
        400,
      );
    }

    const customer = await this.ensureCustomer(licence.customerId);
    const startsAt = toDateOnly(licence.startsAt);
    const expiresAt = toDateOnly(licence.expiresAt);
    const features = (licence.features as string[]) ?? [];

    const payload: LicensePayload = {
      version: LICENSE_PAYLOAD_VERSION,
      licenseId: licence.licenseId,
      companyName: customer.companyName,
      customerEmail: customer.email,
      plan: mapPlanToCore(licence.plan),
      issuedAt: todayUtcDate(),
      startsAt,
      expiresAt,
      maxDevices: dto.maxDevices,
      features,
      notes: licence.notes ?? undefined,
    };

    const signed = this.signingService.signPayload(payload);
    const signedLicenseEnc = this.encryptionService.encrypt(signed.signedLicenseKey);

    const { updated, version } = await this.prisma.$transaction(async (tx) => {
      const updatedLicence = await tx.licence.update({
        where: { id },
        data: {
          maxDevices: dto.maxDevices,
          signedLicenseEnc,
          payloadHash: signed.payloadHash,
          signingKeyId: signed.signingKeyId,
        },
        include: LICENCE_DETAIL_INCLUDE,
      });

      const version = await createVersionAndUpdateCurrent(tx, {
        licenceId: id,
        actionType: LicenceVersionAction.DEVICE_LIMIT_CHANGED,
        plan: updatedLicence.plan,
        maxDevices: dto.maxDevices,
        features: updatedLicence.features,
        validFrom: startsAt,
        validUntil: expiresAt,
        statusSnapshot: updatedLicence.status,
        issuedByAdminId: admin.sub,
        signedLicenseEnc,
        payloadHash: signed.payloadHash,
        signingKeyId: signed.signingKeyId,
        producesNewTg1: true,
        reason: dto.reason,
      });

      return { updated: updatedLicence, version };
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.device_limit_changed',
      entityType: 'Licence',
      entityId: id,
      customerId: updated.customerId,
      licenceId: id,
      metadata: {
        licenseId: updated.licenseId,
        maxDevices: dto.maxDevices,
        reason: dto.reason,
        versionNumber: version.versionNumber,
      },
    });

    let emailResult: EmailLifecycleAttachmentResult | undefined;
    if (dto.emailUpdatedLicence) {
      emailResult = await this.emailCurrentLicenceAttachment(admin, updated, {
        notificationType: NotificationType.LICENSE_REISSUED,
        recipientEmail: dto.recipientEmail,
        fullLicenseKey: signed.signedLicenseKey,
      });
    }

    return {
      ...this.toDetailResponse(updated),
      fullLicenseKey: signed.signedLicenseKey,
      signedLicenseKey: signed.signedLicenseKey,
      emailResult,
    };
  }

  /**
   * Suspends an ACTIVE licence. Suspension is a server-side status transition only: no new
   * TG1 is produced (the desktop app is offline crypto+dates only and cannot be remotely
   * disabled), so the previously issued TG1 remains valid on-disk until it naturally expires
   * or the customer is asked to deactivate. The SUSPENDED status is recorded as a version so
   * the change is auditable.
   */
  async suspend(admin: AuthenticatedAdmin, id: string, dto: SuspendLicenceLifecycleDto) {
    this.assertCanLifecycle(admin.role);
    const licence = await this.getLicenceOrThrow(id);
    this.assertNotRevoked(licence);
    await this.assertPassword(admin, dto.password);

    if (licence.status === LicenseStatus.SUSPENDED) {
      throw new ApiException(ERROR_CODES.LICENCE_ALREADY_SUSPENDED, 'Licence is already suspended', 409);
    }
    if (licence.status !== LicenseStatus.ACTIVE) {
      throw new ApiException(
        ERROR_CODES.LICENCE_INVALID_STATUS_TRANSITION,
        'Only active licences can be suspended',
        400,
      );
    }

    const { updated, version } = await this.prisma.$transaction(async (tx) => {
      const updatedLicence = await tx.licence.update({
        where: { id },
        data: {
          status: LicenseStatus.SUSPENDED,
          suspendedAt: new Date(),
          suspendedByAdminId: admin.sub,
          suspensionReason: dto.reason,
        },
        include: LICENCE_DETAIL_INCLUDE,
      });

      const version = await createVersionAndUpdateCurrent(tx, {
        licenceId: id,
        actionType: LicenceVersionAction.SUSPENDED,
        plan: updatedLicence.plan,
        maxDevices: updatedLicence.maxDevices,
        features: updatedLicence.features,
        validFrom: updatedLicence.startsAt,
        validUntil: updatedLicence.expiresAt,
        statusSnapshot: LicenseStatus.SUSPENDED,
        issuedByAdminId: admin.sub,
        producesNewTg1: false,
        reason: dto.reason,
      });

      return { updated: updatedLicence, version };
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.suspended',
      entityType: 'Licence',
      entityId: id,
      customerId: updated.customerId,
      licenceId: id,
      metadata: { reason: dto.reason, versionNumber: version.versionNumber },
    });
    await this.eventBus?.publish(
      createDomainEvent(DOMAIN_EVENTS.LicenceSuspended, {
        licenceId: id,
        licenseId: updated.licenseId,
        customerId: updated.customerId,
        reason: dto.reason,
      }),
    );

    return this.toDetailResponse(updated);
  }

  /**
   * Reactivates a SUSPENDED licence back to ACTIVE. No new TG1 is produced — the desktop
   * app never received a status-bearing TG1 to begin with, so nothing needs to be re-signed.
   * If the licence's TG1 validity window has already lapsed while suspended, the admin must
   * renew before reactivating (reactivating alone cannot extend the expiry date).
   */
  async reactivate(admin: AuthenticatedAdmin, id: string, dto: ReactivateLicenceDto) {
    this.assertCanLifecycle(admin.role);
    const licence = await this.getLicenceOrThrow(id);
    this.assertNotRevoked(licence);
    await this.assertPassword(admin, dto.password);

    if (licence.status !== LicenseStatus.SUSPENDED) {
      throw new ApiException(ERROR_CODES.LICENCE_NOT_SUSPENDED, 'Only suspended licences can be reactivated', 400);
    }

    if (isExpired(licence.expiresAt)) {
      throw new ApiException(
        ERROR_CODES.LICENCE_INVALID_STATUS_TRANSITION,
        'This licence expired while suspended; renew it before reactivating',
        409,
      );
    }

    const { updated, version } = await this.prisma.$transaction(async (tx) => {
      const updatedLicence = await tx.licence.update({
        where: { id },
        data: {
          status: LicenseStatus.ACTIVE,
          suspendedAt: null,
          suspendedByAdminId: null,
          suspensionReason: null,
        },
        include: LICENCE_DETAIL_INCLUDE,
      });

      const version = await createVersionAndUpdateCurrent(tx, {
        licenceId: id,
        actionType: LicenceVersionAction.REACTIVATED,
        plan: updatedLicence.plan,
        maxDevices: updatedLicence.maxDevices,
        features: updatedLicence.features,
        validFrom: updatedLicence.startsAt,
        validUntil: updatedLicence.expiresAt,
        statusSnapshot: LicenseStatus.ACTIVE,
        issuedByAdminId: admin.sub,
        producesNewTg1: false,
        reason: dto.reason ?? null,
      });

      return { updated: updatedLicence, version };
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.reactivated',
      entityType: 'Licence',
      entityId: id,
      customerId: updated.customerId,
      licenceId: id,
      metadata: { reason: dto.reason ?? null, versionNumber: version.versionNumber },
    });
    await this.eventBus?.publish(
      createDomainEvent(DOMAIN_EVENTS.LicenceReactivated, {
        licenceId: id,
        licenseId: updated.licenseId,
        customerId: updated.customerId,
        reason: dto.reason ?? null,
      }),
    );

    let emailResult: EmailLifecycleAttachmentResult | undefined;
    if (dto.emailUpdatedLicence && updated.signedLicenseEnc) {
      const fullLicenseKey = this.encryptionService.decrypt(updated.signedLicenseEnc);
      emailResult = await this.emailCurrentLicenceAttachment(admin, updated, {
        notificationType: NotificationType.LICENSE_REISSUED,
        recipientEmail: dto.recipientEmail,
        fullLicenseKey,
      });
    }

    return { ...this.toDetailResponse(updated), emailResult };
  }

  /** @deprecated Kept for backward compatibility — delegates to {@link reactivate}. */
  async reinstate(admin: AuthenticatedAdmin, id: string, dto: ReactivateLicenceDto) {
    return this.reactivate(admin, id, dto);
  }

  /**
   * Permanently revokes a licence. Requires the admin to re-type an exact confirmation
   * string (`REVOKE <licenseId>`) in addition to their password. No new TG1 is produced.
   * Once revoked, {@link assertNotRevoked} blocks every further mutation on this licence.
   */
  async revoke(admin: AuthenticatedAdmin, id: string, dto: RevokeLicenceLifecycleDto) {
    this.assertCanLifecycle(admin.role);
    const licence = await this.getLicenceOrThrow(id);

    if (licence.status === LicenseStatus.REVOKED) {
      throw new ApiException(ERROR_CODES.LICENCE_REVOKED, 'Licence is already revoked', 409);
    }
    if (licence.status === LicenseStatus.DRAFT) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATUS_TRANSITION, 'Draft licences cannot be revoked', 400);
    }

    await this.assertPassword(admin, dto.password);

    const expectedConfirmation = `REVOKE ${licence.licenseId}`;
    if (dto.confirmationText !== expectedConfirmation) {
      throw new ApiException(
        ERROR_CODES.LICENCE_REVOKE_CONFIRMATION_INVALID,
        `Confirmation text must exactly match "${expectedConfirmation}"`,
        400,
      );
    }

    const { updated, version } = await this.prisma.$transaction(async (tx) => {
      const updatedLicence = await tx.licence.update({
        where: { id },
        data: {
          status: LicenseStatus.REVOKED,
          revokedAt: new Date(),
          revokedByAdminId: admin.sub,
          revocationReason: dto.reason,
        },
        include: LICENCE_DETAIL_INCLUDE,
      });

      const version = await createVersionAndUpdateCurrent(tx, {
        licenceId: id,
        actionType: LicenceVersionAction.REVOKED,
        plan: updatedLicence.plan,
        maxDevices: updatedLicence.maxDevices,
        features: updatedLicence.features,
        validFrom: updatedLicence.startsAt,
        validUntil: updatedLicence.expiresAt,
        statusSnapshot: LicenseStatus.REVOKED,
        issuedByAdminId: admin.sub,
        producesNewTg1: false,
        reason: dto.reason,
      });

      return { updated: updatedLicence, version };
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.revoked',
      entityType: 'Licence',
      entityId: id,
      customerId: updated.customerId,
      licenceId: id,
      metadata: { reason: dto.reason, versionNumber: version.versionNumber },
    });
    await this.eventBus?.publish(
      createDomainEvent(DOMAIN_EVENTS.LicenceRevoked, {
        licenceId: id,
        licenseId: updated.licenseId,
        customerId: updated.customerId,
        reason: dto.reason,
      }),
    );

    return this.toDetailResponse(updated);
  }

  async reveal(admin: AuthenticatedAdmin, id: string, dto: RevealLicenceDto) {
    if (admin.role === AdminRole.SUPPORT) {
      throw new ApiException(ERROR_CODES.LICENCE_REVEAL_FORBIDDEN, 'Support users cannot reveal licence keys', 403);
    }

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.reveal.requested',
      entityType: 'Licence',
      entityId: id,
      licenceId: id,
      metadata: {},
    });

    const passwordValid = await this.authService.verifyPassword(admin.sub, dto.password);
    if (!passwordValid) {
      await this.auditService.record({
        actorAdminId: admin.sub,
        action: 'licence.reveal.failed',
        entityType: 'Licence',
        entityId: id,
        licenceId: id,
        metadata: { reason: 'invalid_password' },
      });
      throw new ApiException(ERROR_CODES.LICENCE_REVEAL_PASSWORD_INVALID, 'Invalid password', 401);
    }

    const licence = await this.getLicenceOrThrow(id);
    if (!licence.signedLicenseEnc) {
      await this.auditService.record({
        actorAdminId: admin.sub,
        action: 'licence.reveal.failed',
        entityType: 'Licence',
        entityId: id,
        customerId: licence.customerId,
        licenceId: id,
        metadata: { reason: 'not_issued' },
      });
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Licence has not been issued yet', 400);
    }

    const signedLicenseKey = this.encryptionService.decrypt(licence.signedLicenseEnc);

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.revealed',
      entityType: 'Licence',
      entityId: id,
      customerId: licence.customerId,
      licenceId: id,
      metadata: { licenseId: licence.licenseId },
    });

    return {
      licenseId: licence.licenseId,
      signedLicenseKey,
      fullLicenseKey: signedLicenseKey,
    };
  }

  async recordDownloadEvent(
    admin: AuthenticatedAdmin,
    id: string,
    source: 'issue-success' | 'licence-detail',
  ) {
    if (admin.role === AdminRole.SUPPORT) {
      throw new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'Support users cannot download licence files', 403);
    }

    const licence = await this.getLicenceOrThrow(id);
    if (!licence.signedLicenseEnc) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Licence has not been issued yet', 400);
    }

    const recent = await this.prisma.auditLog.findFirst({
      where: {
        action: 'licence.downloaded',
        actorAdminId: admin.sub,
        licenceId: id,
        createdAt: { gte: new Date(Date.now() - 5_000) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recent && (recent.metadata as { source?: string } | null)?.source === source) {
      return { recorded: false, deduplicated: true };
    }

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.downloaded',
      entityType: 'Licence',
      entityId: id,
      customerId: licence.customerId,
      licenceId: id,
      metadata: {
        licenseId: licence.licenseId,
        source,
      },
    });

    return { recorded: true, deduplicated: false };
  }

  async emailLicence(admin: AuthenticatedAdmin, id: string, dto: EmailLicenceDto) {
    this.assertCanReveal(admin.role);

    const licence = await this.getLicenceOrThrow(id);
    if (!licence.signedLicenseEnc) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Licence has not been issued yet', 400);
    }

    const recipientEmail = (dto.recipientEmail?.trim() || licence.customer?.email || '').trim().toLowerCase();
    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      throw new ApiException(ERROR_CODES.VALIDATION_ERROR, 'A valid recipient email is required', 400);
    }

    let fullLicenseKey: string | null = null;
    try {
      await this.auditService.record({
        actorAdminId: admin.sub,
        action: 'licence.email.requested',
        entityType: 'Licence',
        entityId: id,
        customerId: licence.customerId,
        licenceId: id,
        metadata: {
          licenseId: licence.licenseId,
          recipient: recipientEmail,
          source: dto.source,
        },
      });

      fullLicenseKey = await this.resolveTg1ForEmail(admin, licence, dto);
      const attachmentFilename = `${licence.licenseId}.lic`;
      const attachmentContent = `${fullLicenseKey.trim()}\n`;
      const smtpStatus = this.emailProvider.getSafeStatus();
      const fromName = smtpStatus.fromName || 'Patrol Licence Portal';
      const supportEmail = smtpStatus.fromEmail || 'support@techguards.co.uk';
      const features = Array.isArray(licence.features)
        ? (licence.features as unknown as string[])
        : normalizeLicenceFeatures(licence.features as unknown as string[] | undefined);

      const rendered = renderLicenceIssuedTemplate({
        contactName: licence.customer?.contactName?.trim() || licence.customer?.companyName || 'Customer',
        companyName: licence.customer?.companyName || 'Customer',
        licenseId: licence.licenseId,
        plan: licence.plan,
        startsAtDisplay: formatUkDisplayDate(toDateOnly(licence.startsAt)),
        expiresAtDisplay: formatUkDisplayDate(toDateOnly(licence.expiresAt)),
        maxDevices: licence.maxDevices,
        featuresDisplay: features.join(', '),
        activationInstructions: buildLicenceActivationInstructions(),
        supportEmail,
        fromName,
        attachmentFilename,
        adminNote: dto.message?.trim() || undefined,
      });

      const subject = dto.subject?.trim() || buildDefaultLicenceIssuedSubject(licence.licenseId);

      const delivery = await this.notificationService.send({
        notificationType: NotificationType.LICENSE_ISSUED,
        to: recipientEmail,
        subject,
        html: rendered.html,
        text: rendered.text,
        attachments: [
          {
            filename: attachmentFilename,
            content: attachmentContent,
            contentType: LICENCE_FILE_MIME,
          },
        ],
        actorAdminId: admin.sub,
        customerId: licence.customerId,
        licenceId: licence.id,
        source: dto.source,
        metadata: {
          humanLicenseId: licence.licenseId,
          source: dto.source,
          actorAdminId: admin.sub,
          attachmentFilename,
        },
      });

      if (delivery.success) {
        await this.auditService.record({
          actorAdminId: admin.sub,
          action: 'licence.emailed',
          entityType: 'Licence',
          entityId: id,
          customerId: licence.customerId,
          licenceId: id,
          metadata: {
            licenseId: licence.licenseId,
            recipient: recipientEmail,
            source: dto.source,
            notificationLogId: delivery.logId,
          },
        });
      } else {
        await this.auditService.record({
          actorAdminId: admin.sub,
          action: 'licence.email.failed',
          entityType: 'Licence',
          entityId: id,
          customerId: licence.customerId,
          licenceId: id,
          metadata: {
            licenseId: licence.licenseId,
            recipient: recipientEmail,
            source: dto.source,
            notificationLogId: delivery.logId,
            reason: delivery.errorCode || 'NOTIFICATION_SEND_FAILED',
          },
        });
      }

      return {
        success: delivery.success,
        recipient: recipientEmail,
        subject,
        attachmentFilename,
        notificationLogId: delivery.logId,
        status: delivery.status,
        errorCode: delivery.errorCode,
        errorMessage: delivery.errorMessage,
        licence: {
          id: licence.id,
          licenseId: licence.licenseId,
          status: licence.status,
        },
      };
    } finally {
      fullLicenseKey = null;
    }
  }

  private async resolveTg1ForEmail(
    admin: AuthenticatedAdmin,
    licence: { id: string; signedLicenseEnc: string | null },
    dto: EmailLicenceDto,
  ): Promise<string> {
    if (!licence.signedLicenseEnc) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Licence has not been issued yet', 400);
    }

    const storedKey = this.encryptionService.decrypt(licence.signedLicenseEnc);

    if (dto.source === 'licence-detail') {
      if (!dto.password?.trim()) {
        throw new ApiException(ERROR_CODES.VALIDATION_ERROR, 'Password is required to email an existing licence', 400);
      }
      const passwordValid = await this.authService.verifyPassword(admin.sub, dto.password);
      if (!passwordValid) {
        throw new ApiException(ERROR_CODES.LICENCE_REVEAL_PASSWORD_INVALID, 'Invalid password', 401);
      }
      return storedKey;
    }

    const provided = dto.fullLicenseKey?.trim();
    if (!provided?.startsWith('TG1.')) {
      throw new ApiException(
        ERROR_CODES.VALIDATION_ERROR,
        'Issue-success email requires the in-memory TG1 licence key',
        400,
      );
    }
    if (provided !== storedKey) {
      throw new ApiException(
        ERROR_CODES.VALIDATION_ERROR,
        'Provided licence key does not match the issued licence',
        400,
      );
    }
    return provided;
  }

  /**
   * Emails the licence's current TG1 as a .lic attachment after a lifecycle mutation
   * (renew/reissue/change-plan/change-device-limit/reactivate). Never throws — failures are
   * audited and returned as a result so they cannot roll back the lifecycle mutation that
   * already committed.
   */
  private async emailCurrentLicenceAttachment(
    admin: AuthenticatedAdmin,
    licence: LicenceForEmailAttachment,
    options: {
      notificationType: typeof NotificationType.LICENSE_RENEWED | typeof NotificationType.LICENSE_REISSUED;
      recipientEmail?: string;
      fullLicenseKey: string;
      adminNote?: string;
    },
  ): Promise<EmailLifecycleAttachmentResult> {
    try {
      const recipientEmail = (options.recipientEmail?.trim() || licence.customer?.email || '')
        .trim()
        .toLowerCase();
      if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
        return {
          success: false,
          errorCode: ERROR_CODES.VALIDATION_ERROR,
          errorMessage: 'A valid recipient email is required',
        };
      }

      const attachmentFilename = `${licence.licenseId}.lic`;
      const attachmentContent = `${options.fullLicenseKey.trim()}\n`;
      const smtpStatus = this.emailProvider.getSafeStatus();
      const fromName = smtpStatus.fromName || 'Patrol Licence Portal';
      const supportEmail = smtpStatus.fromEmail || 'support@techguards.co.uk';
      const features = Array.isArray(licence.features)
        ? (licence.features as unknown as string[])
        : normalizeLicenceFeatures(licence.features as unknown as string[] | undefined);

      const templateInput = {
        contactName: licence.customer?.contactName?.trim() || licence.customer?.companyName || 'Customer',
        companyName: licence.customer?.companyName || 'Customer',
        licenseId: licence.licenseId,
        plan: licence.plan,
        startsAtDisplay: formatUkDisplayDate(toDateOnly(licence.startsAt)),
        expiresAtDisplay: formatUkDisplayDate(toDateOnly(licence.expiresAt)),
        maxDevices: licence.maxDevices,
        featuresDisplay: features.join(', '),
        activationInstructions: buildLicenceActivationInstructions(),
        supportEmail,
        fromName,
        attachmentFilename,
        adminNote: options.adminNote,
      };

      const rendered =
        options.notificationType === NotificationType.LICENSE_RENEWED
          ? renderLicenceRenewedTemplate(templateInput)
          : renderLicenceReissuedTemplate(templateInput);

      const delivery = await this.notificationService.send({
        notificationType: options.notificationType,
        to: recipientEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        attachments: [
          {
            filename: attachmentFilename,
            content: attachmentContent,
            contentType: LICENCE_FILE_MIME,
          },
        ],
        actorAdminId: admin.sub,
        customerId: licence.customerId,
        licenceId: licence.id,
        source: 'lifecycle',
        metadata: {
          humanLicenseId: licence.licenseId,
          source: 'lifecycle',
          actorAdminId: admin.sub,
          attachmentFilename,
        },
      });

      await this.auditService.record({
        actorAdminId: admin.sub,
        action: delivery.success ? 'licence.emailed' : 'licence.email.failed',
        entityType: 'Licence',
        entityId: licence.id,
        customerId: licence.customerId,
        licenceId: licence.id,
        metadata: {
          licenseId: licence.licenseId,
          recipient: recipientEmail,
          source: 'lifecycle',
          notificationLogId: delivery.logId,
          ...(delivery.success ? {} : { reason: delivery.errorCode || 'NOTIFICATION_SEND_FAILED' }),
        },
      });

      return {
        success: delivery.success,
        recipient: recipientEmail,
        notificationLogId: delivery.logId,
        errorCode: delivery.errorCode,
        errorMessage: delivery.errorMessage,
      };
    } catch (error) {
      this.logger.warn(
        `emailCurrentLicenceAttachment failed for licence ${licence.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        success: false,
        errorCode: error instanceof ApiException ? error.code : 'NOTIFICATION_SEND_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Failed to send licence email',
      };
    }
  }

  private assertCanReveal(role: AdminRole): void {
    if (role === AdminRole.SUPPORT) {
      throw new ApiException(ERROR_CODES.LICENCE_REVEAL_FORBIDDEN, 'Support users cannot email licence keys', 403);
    }
  }

  async addInstallation(admin: AuthenticatedAdmin, licenceId: string, dto: CreateInstallationDto) {
    const licence = await this.getLicenceOrThrow(licenceId);
    const activeCount = await this.prisma.installation.count({
      where: { licenceId, status: { in: ['PENDING', 'ACTIVE'] } },
    });
    if (activeCount >= licence.maxDevices) {
      throw new ApiException(ERROR_CODES.INSTALLATION_LIMIT_REACHED, 'Installation limit reached for this licence', 409);
    }

    const installation = await this.prisma.installation.create({
      data: {
        licenceId,
        installationId: dto.installationId,
        deviceLabel: dto.deviceLabel,
        customerProvidedAt: dto.customerProvidedAt ? new Date(dto.customerProvidedAt) : null,
        status: dto.status,
        notes: dto.notes,
      },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'installation.created',
      entityType: 'Installation',
      entityId: installation.id,
      customerId: licence.customerId,
      licenceId,
      metadata: { installationId: dto.installationId },
    });

    return installation;
  }

  async updateInstallation(
    admin: AuthenticatedAdmin,
    licenceId: string,
    installationId: string,
    dto: UpdateInstallationDto,
  ) {
    await this.getLicenceOrThrow(licenceId);
    const installation = await this.prisma.installation.findFirst({
      where: { licenceId, id: installationId },
    });
    if (!installation) {
      throw new ApiException(ERROR_CODES.INSTALLATION_NOT_FOUND, 'Installation not found', 404);
    }

    const updated = await this.prisma.installation.update({
      where: { id: installation.id },
      data: {
        deviceLabel: dto.deviceLabel,
        customerProvidedAt: dto.customerProvidedAt ? new Date(dto.customerProvidedAt) : undefined,
        firstSeenAt: dto.firstSeenAt ? new Date(dto.firstSeenAt) : undefined,
        lastSeenAt: dto.lastSeenAt ? new Date(dto.lastSeenAt) : undefined,
        status: dto.status,
        notes: dto.notes,
      },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'installation.updated',
      entityType: 'Installation',
      entityId: updated.id,
      licenceId,
      metadata: { installationId: updated.installationId, status: updated.status },
    });

    return updated;
  }

  private assertCanIssue(role: AdminRole): void {
    if (role === AdminRole.SUPPORT) {
      throw new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'Support users cannot issue or renew licences', 403);
    }
  }

  /** Support users cannot perform any lifecycle mutation (renew/reissue/suspend/reactivate/revoke/plan/device-limit). */
  private assertCanLifecycle(role: AdminRole): void {
    if (role === AdminRole.SUPPORT) {
      throw new ApiException(
        ERROR_CODES.FORBIDDEN_ROLE,
        'Support users cannot perform licence lifecycle actions',
        403,
      );
    }
  }

  /** Verifies the acting admin's password for a sensitive lifecycle mutation. Never logs the password. */
  private async assertPassword(admin: AuthenticatedAdmin, password: string): Promise<void> {
    const valid = await this.authService.verifyPassword(admin.sub, password);
    if (!valid) {
      throw new ApiException(ERROR_CODES.LICENCE_REVEAL_PASSWORD_INVALID, 'Invalid password', 401);
    }
  }

  /** Blocks any further mutation once a licence has been revoked. */
  private assertNotRevoked(licence: { status: LicenseStatus }): void {
    if (licence.status === LicenseStatus.REVOKED) {
      throw new ApiException(
        ERROR_CODES.LICENCE_REVOKED,
        'This licence has been revoked and can no longer be modified',
        409,
      );
    }
  }

  private async getLicenceOrThrow(id: string) {
    const licence = await this.prisma.licence.findUnique({
      where: { id },
      include: LICENCE_DETAIL_INCLUDE,
    });
    if (!licence) {
      throw new ApiException(ERROR_CODES.LICENCE_NOT_FOUND, 'Licence not found', 404);
    }
    return licence;
  }

  private async ensureCustomer(customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      throw new ApiException(ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found', 404);
    }
    return customer;
  }

  private async ensureCustomerEligible(customerId: string) {
    const customer = await this.ensureCustomer(customerId);
    if (customer.status === CustomerStatus.CLOSED) {
      throw new ApiException(
        ERROR_CODES.LICENCE_CUSTOMER_INELIGIBLE,
        'Cannot issue a licence to a CLOSED customer',
        400,
      );
    }
    if (customer.status === CustomerStatus.SUSPENDED) {
      throw new ApiException(
        ERROR_CODES.LICENCE_CUSTOMER_INELIGIBLE,
        'Cannot issue a licence to a SUSPENDED customer',
        400,
      );
    }
    return customer;
  }

  private normalizeAndValidateFeatures(features: string[] | undefined | null): string[] {
    const normalized = normalizeLicenceFeatures(features);
    const effective = normalized.length > 0 ? normalized : [...REQUIRED_LICENCE_FEATURES];
    const unsupported = effective.filter(
      (feature) => !(SUPPORTED_LICENCE_FEATURES as readonly string[]).includes(feature),
    );
    if (unsupported.length > 0) {
      throw new ApiException(
        ERROR_CODES.LICENCE_FEATURES_INVALID,
        `Unsupported licence features: ${unsupported.join(', ')}`,
        400,
      );
    }
    if (!hasRequiredLicenceFeatures(effective)) {
      throw new ApiException(
        ERROR_CODES.LICENCE_FEATURES_INVALID,
        'Licence features must include collector',
        400,
      );
    }
    return effective;
  }

  private validatePaymentFields(dto: IssueLicenceDto): void {
    if (dto.amountPence !== undefined && dto.amountPence < 0) {
      throw new ApiException(ERROR_CODES.LICENCE_PAYMENT_INVALID, 'amountPence must be non-negative', 400);
    }
    if (dto.paymentStatus === PaymentStatus.PAID && !dto.paymentReference?.trim()) {
      throw new ApiException(
        ERROR_CODES.LICENCE_PAYMENT_INVALID,
        'paymentReference is required when paymentStatus is PAID',
        400,
      );
    }
    if (
      dto.paymentStatus === PaymentStatus.FAILED ||
      dto.paymentStatus === PaymentStatus.REFUNDED
    ) {
      throw new ApiException(
        ERROR_CODES.LICENCE_PAYMENT_INVALID,
        'FAILED and REFUNDED are not valid for initial licence issuance',
        400,
      );
    }
  }

  private toListResponse(licence: {
    id: string;
    licenseId: string;
    customerId: string;
    plan: LicensePlan;
    status: LicenseStatus;
    startsAt: Date;
    expiresAt: Date;
    maxDevices: number;
    signedLicenseEnc: string | null;
    customer?: { companyName: string };
  }) {
    return {
      id: licence.id,
      licenseId: licence.licenseId,
      customerId: licence.customerId,
      companyName: licence.customer?.companyName,
      plan: licence.plan,
      status: licence.status,
      effectiveStatus: deriveEffectiveStatus(licence),
      startsAt: toDateOnly(licence.startsAt),
      expiresAt: toDateOnly(licence.expiresAt),
      maxDevices: licence.maxDevices,
      maskedKey: maskStoredLicenceKey(licence.signedLicenseEnc, this.encryptionService),
    };
  }

  private toDetailResponse(licence: {
    id: string;
    licenseId: string;
    customerId: string;
    plan: LicensePlan;
    status: LicenseStatus;
    issuedAt: Date | null;
    startsAt: Date;
    expiresAt: Date;
    maxDevices: number;
    features: unknown;
    notes: string | null;
    payloadHash: string | null;
    signingKeyId: string | null;
    previousLicenceId: string | null;
    signedLicenseEnc: string | null;
    suspendedAt?: Date | null;
    suspensionReason?: string | null;
    revokedAt?: Date | null;
    revocationReason?: string | null;
    customer?: { companyName: string; email: string; contactName?: string | null };
    installations?: unknown[];
    payments?: unknown[];
    renewals?: Array<{ id: string; licenseId: string; status: LicenseStatus }>;
    previousLicence?: { id: string; licenseId: string } | null;
  }) {
    return {
      id: licence.id,
      licenseId: licence.licenseId,
      customerId: licence.customerId,
      companyName: licence.customer?.companyName,
      customerEmail: licence.customer?.email,
      plan: licence.plan,
      status: licence.status,
      effectiveStatus: deriveEffectiveStatus(licence),
      issuedAt: licence.issuedAt?.toISOString() ?? null,
      startsAt: toDateOnly(licence.startsAt),
      expiresAt: toDateOnly(licence.expiresAt),
      maxDevices: licence.maxDevices,
      features: licence.features,
      notes: licence.notes,
      payloadHash: licence.payloadHash,
      signingKeyId: licence.signingKeyId,
      previousLicenceId: licence.previousLicenceId,
      previousLicence: licence.previousLicence,
      renewals: licence.renewals,
      installations: licence.installations,
      payments: licence.payments,
      suspendedAt: licence.suspendedAt?.toISOString() ?? null,
      suspensionReason: licence.suspensionReason,
      revokedAt: licence.revokedAt?.toISOString() ?? null,
      revocationReason: licence.revocationReason,
      maskedKey: maskStoredLicenceKey(licence.signedLicenseEnc, this.encryptionService),
      offlineEnforcementWarning:
        licence.status === LicenseStatus.SUSPENDED || licence.status === LicenseStatus.REVOKED
          ? 'Offline desktop licences already activated cannot be remotely disabled until online activation is introduced.'
          : null,
    };
  }
}

function addDaysUtc(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function isExpired(expiresAt: Date): boolean {
  const today = todayUtcDate();
  return today > toDateOnly(expiresAt);
}

function formatUkDisplayDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  if (!year || !month || !day) {
    return isoDate;
  }
  return `${day}/${month}/${year}`;
}
