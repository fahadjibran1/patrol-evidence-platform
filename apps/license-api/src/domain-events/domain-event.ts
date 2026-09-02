import { randomUUID } from 'crypto';

/**
 * Envelope for a fire-and-forget domain event published on the in-process {@link EventBus}.
 * `type` should be one of the constants in `domain-event.types.ts`.
 */
export interface DomainEvent<T = unknown> {
  type: string;
  occurredAt: Date;
  correlationId?: string;
  payload: T;
}

/** Convenience constructor that fills in `occurredAt` and a default `correlationId`. */
export function createDomainEvent<T>(
  type: string,
  payload: T,
  correlationId?: string,
): DomainEvent<T> {
  return {
    type,
    occurredAt: new Date(),
    correlationId: correlationId ?? randomUUID(),
    payload,
  };
}
