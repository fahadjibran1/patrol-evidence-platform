import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

const SENSITIVE_KEY_PATTERN =
  /password|token|secret|signedLicense|fullLicense|licenseKey|privateKey|authorization|refresh|smtp/i;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    actorAdminId?: string | null;
    actorCustomerUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    customerId?: string | null;
    licenceId?: string | null;
    metadata?: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorAdminId: input.actorAdminId ?? null,
        actorCustomerUserId: input.actorCustomerUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        customerId: input.customerId ?? null,
        licenceId: input.licenceId ?? null,
        metadata: this.sanitizeMetadata(input.metadata) as Prisma.InputJsonValue | undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  sanitizeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | undefined {
    if (!metadata) {
      return undefined;
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        continue;
      }
      if (typeof value === 'string' && value.startsWith('TG1.')) {
        sanitized[key] = '[redacted-licence-key]';
        continue;
      }
      sanitized[key] = value;
    }
    return sanitized;
  }
}
