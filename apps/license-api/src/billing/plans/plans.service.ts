import { Injectable } from '@nestjs/common';
import { PlanStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { FeatureService } from '../shared/feature.service';
import { PlanFeatureResolver } from '../shared/plan-feature-resolver';
import { CreatePlanDto, ListPlansQueryDto, UpdatePlanDto } from './dto/plan.dto';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly featureService: FeatureService,
    private readonly planFeatureResolver: PlanFeatureResolver,
  ) {}

  async list(query: ListPlansQueryDto = {}) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.publicOnly ? { isPublic: true, status: PlanStatus.ACTIVE } : {}),
    };
    const plans = await this.prisma.plan.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return { items: plans.map((plan) => this.serialize(plan)), total: plans.length };
  }

  async getById(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      throw new ApiException(ERROR_CODES.PLAN_NOT_FOUND, 'Plan not found', 404);
    }
    return this.serialize(plan);
  }

  async getByCode(code: string) {
    const plan = await this.prisma.plan.findUnique({ where: { code: code.toUpperCase() } });
    if (!plan) {
      throw new ApiException(ERROR_CODES.PLAN_NOT_FOUND, 'Plan not found', 404);
    }
    return this.serialize(plan);
  }

  async create(admin: AuthenticatedAdmin, dto: CreatePlanDto) {
    const features = this.featureService.assertKnownFeatures(dto.includedFeatures ?? []);
    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.plan.findUnique({ where: { code } });
    if (existing) {
      throw new ApiException(ERROR_CODES.PLAN_CODE_EXISTS, 'Plan code already exists', 409);
    }

    const plan = await this.prisma.plan.create({
      data: {
        code,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        status: dto.status ?? PlanStatus.DRAFT,
        monthlyPrice: dto.monthlyPrice,
        annualPrice: dto.annualPrice,
        currency: (dto.currency ?? 'GBP').toUpperCase(),
        billingInterval: dto.billingInterval,
        trialDays: dto.trialDays ?? 0,
        maxDevices: dto.maxDevices ?? 1,
        includedFeatures: features,
        supportLevel: dto.supportLevel,
        sortOrder: dto.sortOrder ?? 100,
        isPublic: dto.isPublic ?? true,
      },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.plan_created',
      entityType: 'Plan',
      entityId: plan.id,
      metadata: { code: plan.code },
    });

    return this.serialize(plan);
  }

  async update(admin: AuthenticatedAdmin, id: string, dto: UpdatePlanDto) {
    await this.getById(id);
    const features = dto.includedFeatures
      ? this.featureService.assertKnownFeatures(dto.includedFeatures)
      : undefined;

    const plan = await this.prisma.plan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.monthlyPrice !== undefined ? { monthlyPrice: dto.monthlyPrice } : {}),
        ...(dto.annualPrice !== undefined ? { annualPrice: dto.annualPrice } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency.toUpperCase() } : {}),
        ...(dto.billingInterval !== undefined ? { billingInterval: dto.billingInterval } : {}),
        ...(dto.trialDays !== undefined ? { trialDays: dto.trialDays } : {}),
        ...(dto.maxDevices !== undefined ? { maxDevices: dto.maxDevices } : {}),
        ...(features !== undefined ? { includedFeatures: features } : {}),
        ...(dto.supportLevel !== undefined ? { supportLevel: dto.supportLevel } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
      },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.plan_updated',
      entityType: 'Plan',
      entityId: plan.id,
      metadata: { code: plan.code },
    });

    return this.serialize(plan);
  }

  serialize(plan: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    status: PlanStatus;
    monthlyPrice: number;
    annualPrice: number;
    currency: string;
    billingInterval: string;
    trialDays: number;
    maxDevices: number;
    includedFeatures: unknown;
    supportLevel: string;
    sortOrder: number;
    isPublic: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      status: plan.status,
      monthlyPrice: plan.monthlyPrice,
      annualPrice: plan.annualPrice,
      currency: plan.currency,
      billingInterval: plan.billingInterval,
      trialDays: plan.trialDays,
      maxDevices: plan.maxDevices,
      includedFeatures: this.planFeatureResolver.resolveBillingFeatures(plan.includedFeatures),
      licenceFeatures: this.planFeatureResolver.resolveLicenceFeatures(plan.includedFeatures),
      supportLevel: plan.supportLevel,
      sortOrder: plan.sortOrder,
      isPublic: plan.isPublic,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }
}
