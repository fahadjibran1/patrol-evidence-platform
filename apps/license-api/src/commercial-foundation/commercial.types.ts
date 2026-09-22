import { CommercialActorType, CommercialOrderState } from '@prisma/client';

export interface CommercialActorContext {
  actorType: CommercialActorType;
  actorAdminId?: string | null;
  actorCustomerUserId?: string | null;
  actorId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CommercialTransitionInput {
  publicOrderId: string;
  to: CommercialOrderState;
  correlationId?: string;
  actor: CommercialActorContext;
  failureCode?: string;
  failureMessage?: string;
  holdReason?: string;
  metadata?: Record<string, unknown>;
}
