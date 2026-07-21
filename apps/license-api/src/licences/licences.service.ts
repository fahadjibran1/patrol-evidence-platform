import { Injectable } from '@nestjs/common';
import { AdminRole, CustomerStatus, LicensePlan, LicenseStatus, PaymentStatus, Prisma } from '@prisma/client';
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
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import {
  allocateLicenseId,
  computeExpiresAt,
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
import { CreateDraftLicenceDto, IssueLicenceDto, RenewLicenceDto, RevealLicenceDto } from './dto/licence.dto';
import { SuspendLicenceDto, RevokeLicenceDto } from './dto/licence-actions.dto';
import { CreateInstallationDto, UpdateInstallationDto } from './dto/installation.dto';

@Injectable()
export class LicencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signingService: SigningService,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
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
    return this.toDetailResponse(licence);
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
          include: { customer: true, renewals: true, previousLicence: true, payments: true, installations: true },
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

  async issueExisting(admin: AuthenticatedAdmin, id: string, dto: Partial<IssueLicenceDto>) {
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

    const updated = await this.prisma.licence.update({
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
      include: { customer: true, renewals: true, previousLicence: true },
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

    const detail = this.toDetailResponse(updated);
    return {
      licence: detail,
      fullLicenseKey: signed.signedLicenseKey,
      signedLicenseKey: signed.signedLicenseKey,
      licenseKey: signed.signedLicenseKey,
      ...detail,
    };
  }

  async renew(admin: AuthenticatedAdmin, id: string, dto: RenewLicenceDto) {
    this.assertCanIssue(admin.role);
    const source = await this.getLicenceOrThrow(id);

    if (source.status === LicenseStatus.DRAFT) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Draft licences must be issued, not renewed', 400);
    }
    if (source.status === LicenseStatus.REVOKED) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Revoked licences cannot be renewed', 400);
    }

    const customer = await this.ensureCustomer(source.customerId);
    const defaultStart = addDaysUtc(toDateOnly(source.expiresAt), 1);
    const startsAt = dto.startsAt ?? defaultStart;
    const plan = dto.plan ?? source.plan;
    const expiresAt = computeExpiresAt(startsAt, plan, dto.expiresAt);

    if (startsAt > expiresAt) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_DATE_RANGE, 'startsAt must be on or before expiresAt', 400);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const licenseId = await allocateLicenseId(tx);
      const payload: LicensePayload = {
        version: LICENSE_PAYLOAD_VERSION,
        licenseId,
        companyName: customer.companyName,
        customerEmail: customer.email,
        plan: mapPlanToCore(plan),
        issuedAt: todayUtcDate(),
        startsAt,
        expiresAt,
        maxDevices: dto.maxDevices ?? source.maxDevices,
        features: (dto.features ?? source.features) as string[],
        notes: dto.notes ?? source.notes ?? undefined,
      };

      const signed = this.signingService.signPayload(payload);
      const signedLicenseEnc = this.encryptionService.encrypt(signed.signedLicenseKey);

      const renewed = await tx.licence.create({
        data: {
          licenseId,
          customerId: source.customerId,
          plan,
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
          previousLicenceId: source.id,
          createdByAdminId: admin.sub,
        },
        include: { customer: true, previousLicence: true },
      });

      return { renewed, signedLicenseKey: signed.signedLicenseKey };
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.renewed',
      entityType: 'Licence',
      entityId: result.renewed.id,
      customerId: result.renewed.customerId,
      licenceId: result.renewed.id,
      metadata: {
        previousLicenceId: source.licenseId,
        newLicenceId: result.renewed.licenseId,
      },
    });

    return {
      ...this.toDetailResponse(result.renewed),
      signedLicenseKey: result.signedLicenseKey,
    };
  }

  async suspend(admin: AuthenticatedAdmin, id: string, dto: SuspendLicenceDto) {
    this.assertCanManageLifecycle(admin.role);
    const licence = await this.getLicenceOrThrow(id);
    if (licence.status !== LicenseStatus.ACTIVE && licence.status !== LicenseStatus.EXPIRED) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Only active or expired licences can be suspended', 400);
    }

    const updated = await this.prisma.licence.update({
      where: { id },
      data: {
        status: LicenseStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspendedByAdminId: admin.sub,
        suspensionReason: dto.reason,
      },
      include: { customer: true },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.suspended',
      entityType: 'Licence',
      entityId: id,
      customerId: updated.customerId,
      licenceId: id,
      metadata: { reason: dto.reason },
    });

    return this.toDetailResponse(updated);
  }

  async reinstate(admin: AuthenticatedAdmin, id: string) {
    this.assertCanManageLifecycle(admin.role);
    const licence = await this.getLicenceOrThrow(id);

    if (licence.status === LicenseStatus.REVOKED) {
      throw new ApiException(
        ERROR_CODES.LICENCE_CANNOT_REINSTATE_REVOKED,
        'Revoked licences cannot be reinstated',
        409,
      );
    }
    if (licence.status !== LicenseStatus.SUSPENDED) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Only suspended licences can be reinstated', 400);
    }

    const nextStatus = isExpired(licence.expiresAt) ? LicenseStatus.EXPIRED : LicenseStatus.ACTIVE;
    const updated = await this.prisma.licence.update({
      where: { id },
      data: {
        status: nextStatus,
        suspendedAt: null,
        suspendedByAdminId: null,
        suspensionReason: null,
      },
      include: { customer: true },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.reinstated',
      entityType: 'Licence',
      entityId: id,
      customerId: updated.customerId,
      licenceId: id,
    });

    return this.toDetailResponse(updated);
  }

  async revoke(admin: AuthenticatedAdmin, id: string, dto: RevokeLicenceDto) {
    this.assertCanManageLifecycle(admin.role);
    const licence = await this.getLicenceOrThrow(id);
    if (licence.status === LicenseStatus.REVOKED) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Licence is already revoked', 400);
    }
    if (licence.status === LicenseStatus.DRAFT) {
      throw new ApiException(ERROR_CODES.LICENCE_INVALID_STATE, 'Draft licences cannot be revoked', 400);
    }

    const updated = await this.prisma.licence.update({
      where: { id },
      data: {
        status: LicenseStatus.REVOKED,
        revokedAt: new Date(),
        revokedByAdminId: admin.sub,
        revocationReason: dto.reason,
      },
      include: { customer: true },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'licence.revoked',
      entityType: 'Licence',
      entityId: id,
      customerId: updated.customerId,
      licenceId: id,
      metadata: { reason: dto.reason },
    });

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

  private assertCanManageLifecycle(role: AdminRole): void {
    if (role === AdminRole.SUPPORT) {
      throw new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'Support users cannot suspend or revoke licences', 403);
    }
  }

  private async getLicenceOrThrow(id: string) {
    const licence = await this.prisma.licence.findUnique({
      where: { id },
      include: {
        customer: true,
        installations: true,
        payments: true,
        renewals: true,
        previousLicence: true,
      },
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
    customer?: { companyName: string; email: string };
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
