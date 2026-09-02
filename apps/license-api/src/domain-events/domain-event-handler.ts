import type { DomainEvent } from './domain-event';

/**
 * Implemented by anything that wants to react to domain events published on the
 * {@link EventBus}. `handles` lists the event type strings this handler cares about
 * (use `'*'` to receive every event).
 */
export interface DomainEventHandler<T = unknown> {
  readonly handles: string[];
  handle(event: DomainEvent<T>): Promise<void>;
}
