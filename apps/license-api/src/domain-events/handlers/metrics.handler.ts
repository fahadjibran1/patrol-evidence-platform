import { Injectable, Optional } from '@nestjs/common';
import type { DomainEvent } from '../domain-event';
import type { DomainEventHandler } from '../domain-event-handler';
import { DOMAIN_EVENTS } from '../domain-event.types';
import { MetricsService } from '@/metrics/metrics.service';

/** Thin handler that feeds domain events into in-memory counters for /admin/metrics. */
@Injectable()
export class MetricsDomainEventHandler implements DomainEventHandler {
  readonly handles: string[] = [
    DOMAIN_EVENTS.LicenceIssued,
    DOMAIN_EVENTS.LicenceRenewed,
    DOMAIN_EVENTS.NotificationSent,
    DOMAIN_EVENTS.NotificationFailed,
  ];

  constructor(@Optional() private readonly metricsService?: MetricsService) {}

  async handle(event: DomainEvent): Promise<void> {
    if (!this.metricsService) {
      return;
    }
    switch (event.type) {
      case DOMAIN_EVENTS.LicenceIssued:
        this.metricsService.increment('licenceIssues');
        break;
      case DOMAIN_EVENTS.LicenceRenewed:
        this.metricsService.increment('renewals');
        break;
      case DOMAIN_EVENTS.NotificationSent:
        this.metricsService.increment('emailsSent');
        break;
      case DOMAIN_EVENTS.NotificationFailed:
        this.metricsService.increment('emailsFailed');
        break;
      default:
        break;
    }
  }
}
