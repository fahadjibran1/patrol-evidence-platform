import { Injectable } from '@nestjs/common';
import { CommercialActorType, Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AuthService } from '@/auth/auth.service';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { adminHasCommercialPermission, CommercialOperatorPermission } from './commercial-operator-permissions';
import { createCommercialAudit } from './commercial-persistence.util';

const PURPOSE = 'commercial-approval';
const STEP_UP_TTL_MS = 5 * 60_000;

@Injectable()
export class CommercialStepUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async create(admin: AuthenticatedAdmin, password: string, correlationId = randomUUID()) {
    this.assertApprover(admin);
    if (!(await this.auth.verifyPassword(admin.sub, password))) {
      await this.audit.record({
        actorType: CommercialActorType.OPERATOR,
        actorAdminId: admin.sub,
        action: 'commercial.step_up.denied',
        entityType: 'Admin',
        entityId: admin.sub,
        correlationId,
        metadata: { reason: 'password_verification_failed' },
      });
      throw new ApiException(ERROR_CODES.COMMERCIAL_STEP_UP_INVALID, 'Recent password verification failed.', 401);
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + STEP_UP_TTL_MS);
    await this.prisma.commercialOperatorStepUp.create({
      data: { adminId: admin.sub, tokenHash: this.hash(token), purpose: PURPOSE, expiresAt },
    });
    await this.audit.record({
      actorType: CommercialActorType.OPERATOR,
      actorAdminId: admin.sub,
      action: 'commercial.step_up.succeeded',
      entityType: 'Admin',
      entityId: admin.sub,
      correlationId,
      metadata: { purpose: PURPOSE, expiresAt: expiresAt.toISOString() },
    });
    return { stepUpToken: token, expiresAt: expiresAt.toISOString() };
  }

  async consume(
    tx: Prisma.TransactionClient,
    admin: AuthenticatedAdmin,
    rawToken: string | undefined,
    correlationId: string,
  ): Promise<void> {
    this.assertApprover(admin);
    if (!rawToken || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_STEP_UP_REQUIRED, 'A recent one-time approval step-up is required.', 401);
    }
    const now = new Date();
    const changed = await tx.commercialOperatorStepUp.updateMany({
      where: {
        adminId: admin.sub,
        tokenHash: this.hash(rawToken),
        purpose: PURPOSE,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (changed.count !== 1) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_STEP_UP_INVALID, 'Approval step-up is invalid, expired, or already used.', 401);
    }
    await createCommercialAudit(tx, this.audit, {
      actorType: CommercialActorType.OPERATOR,
      actorAdminId: admin.sub,
      action: 'commercial.step_up.consumed',
      entityType: 'Admin',
      entityId: admin.sub,
      correlationId,
      metadata: { purpose: PURPOSE },
    });
  }

  private assertApprover(admin: AuthenticatedAdmin): void {
    if (!adminHasCommercialPermission(admin.role, CommercialOperatorPermission.APPROVE_ISSUANCE)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_OPERATOR_FORBIDDEN, 'Commercial approval permission is required.', 403);
    }
  }

  private hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
