import { Injectable, Logger } from '@nestjs/common';
import type { DomainEvent } from '../domain-event';
import type { DomainEventHandler } from '../domain-event-handler';
import { DASHBOARD_INVALIDATING_EVENTS } from '../domain-event.types';
import { DashboardService } from '@/dashboard/dashboard.service';

/**
 * Invalidates the in-memory dashboard summary cache whenever a licence, customer,
 * notification, or payment domain event is published so the next dashboard read is fresh.
 */
@Injectable()
export class DashboardCacheHandler implements DomainEventHandler {
  private readonly logger = new Logger(DashboardCacheHandler.name);
  readonly handles: string[] = DASHBOARD_INVALIDATING_EVENTS;

  constructor(private readonly dashboardService: DashboardService) {}

  async handle(event: DomainEvent): Promise<void> {
    this.dashboardService.invalidateAll();
    this.logger.debug(`Dashboard cache invalidated by "${event.type}"`);
  }
}
