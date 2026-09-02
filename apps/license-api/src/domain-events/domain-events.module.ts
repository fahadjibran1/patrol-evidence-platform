import { Global, Module, OnModuleInit } from '@nestjs/common';
import { EventBus } from './event-bus.service';
import { DashboardCacheHandler } from './handlers/dashboard-cache.handler';
import { MetricsDomainEventHandler } from './handlers/metrics.handler';
import { DashboardModule } from '@/dashboard/dashboard.module';
import { LicencesModule } from '@/licences/licences.module';
import { LicenceBillingSyncHandler } from '@/licences/licence-billing-sync.handler';

/**
 * Global module exposing the in-process {@link EventBus}. Any service can inject `EventBus`
 * to publish domain events; built-in handlers (dashboard cache invalidation, metrics,
 * licence billing sync) are registered here on module init.
 */
@Global()
@Module({
  imports: [DashboardModule, LicencesModule],
  providers: [EventBus, DashboardCacheHandler, MetricsDomainEventHandler],
  exports: [EventBus],
})
export class DomainEventsModule implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBus,
    private readonly dashboardCacheHandler: DashboardCacheHandler,
    private readonly metricsDomainEventHandler: MetricsDomainEventHandler,
    private readonly licenceBillingSyncHandler: LicenceBillingSyncHandler,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(this.dashboardCacheHandler);
    this.eventBus.subscribe(this.metricsDomainEventHandler);
    this.eventBus.subscribe(this.licenceBillingSyncHandler);
  }
}
