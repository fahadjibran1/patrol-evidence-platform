import { Injectable, Logger } from '@nestjs/common';
import type { DomainEvent } from './domain-event';
import type { DomainEventHandler } from './domain-event-handler';

/**
 * Minimal in-process pub/sub bus for domain events. Publishing never throws: each handler
 * is invoked independently and a handler failure is logged, not propagated, so a broken
 * subscriber (e.g. a cache invalidator) can never break the publisher's request flow.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly handlers: DomainEventHandler[] = [];

  subscribe(handler: DomainEventHandler): void {
    this.handlers.push(handler);
  }

  unsubscribe(handler: DomainEventHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index >= 0) {
      this.handlers.splice(index, 1);
    }
  }

  /** Publishes an event to all matching handlers and resolves once they have all run. Never rejects. */
  async publish<T>(event: DomainEvent<T>): Promise<void> {
    const matching = this.handlers.filter(
      (handler) => handler.handles.includes('*') || handler.handles.includes(event.type),
    );

    await Promise.all(
      matching.map(async (handler) => {
        try {
          await handler.handle(event);
        } catch (error) {
          this.logger.error(
            `Domain event handler failed for "${event.type}": ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }),
    );
  }

  /** Number of currently subscribed handlers — useful for diagnostics/tests. */
  get handlerCount(): number {
    return this.handlers.length;
  }
}
