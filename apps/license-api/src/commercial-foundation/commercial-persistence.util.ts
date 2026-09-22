import { randomUUID } from 'crypto';
import { Prisma, type CommercialActorType } from '@prisma/client';
import type { AuditService } from '@/audit/audit.service';

type TransactionClient = Prisma.TransactionClient;

export async function createCommercialAudit(
  tx: TransactionClient,
  auditService: AuditService,
  input: {
    actorType: CommercialActorType;
    actorAdminId?: string | null;
    actorCustomerUserId?: string | null;
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    customerId?: string | null;
    correlationId: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorType: input.actorType,
      actorAdminId: input.actorAdminId ?? null,
      actorCustomerUserId: input.actorCustomerUserId ?? null,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      customerId: input.customerId ?? null,
      correlationId: input.correlationId,
      metadata: auditService.sanitizeMetadata(input.metadata) as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function createCommercialOutboxEvent(
  tx: TransactionClient,
  input: {
    idempotencyKey: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
    correlationId: string;
  },
): Promise<void> {
  await tx.commercialOutboxEvent.create({
    data: {
      eventId: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload as Prisma.InputJsonValue,
      correlationId: input.correlationId,
    },
  });
}
