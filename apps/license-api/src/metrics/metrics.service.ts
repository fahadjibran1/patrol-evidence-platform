import { Injectable } from '@nestjs/common';

export type MetricsCounterName =
  | 'requests'
  | 'emailsSent'
  | 'emailsFailed'
  | 'renewals'
  | 'licenceIssues'
  | 'loginFailures'
  | 'stripeCheckoutCreated'
  | 'stripeCheckoutCompleted'
  | 'stripeWebhookReceived'
  | 'stripeWebhookFailed'
  | 'stripeWebhookDeadLetter'
  | 'stripePaymentSucceeded'
  | 'stripePaymentFailed'
  | 'stripeReconciliationMismatch';

interface LatencyAccumulator {
  sum: number;
  count: number;
}

export interface MetricsSnapshot {
  counters: Record<MetricsCounterName, number>;
  requestLatency: {
    avgMs: number;
    count: number;
  };
  dashboardLoadMs: {
    last: number | null;
    avg: number;
  };
  uptimeSeconds: number;
  generatedAt: string;
}

const COUNTER_NAMES: MetricsCounterName[] = [
  'requests',
  'emailsSent',
  'emailsFailed',
  'renewals',
  'licenceIssues',
  'loginFailures',
  'stripeCheckoutCreated',
  'stripeCheckoutCompleted',
  'stripeWebhookReceived',
  'stripeWebhookFailed',
  'stripeWebhookDeadLetter',
  'stripePaymentSucceeded',
  'stripePaymentFailed',
  'stripeReconciliationMismatch',
];

/**
 * Simple in-memory metrics store. Process-local only (no cross-instance aggregation) —
 * suitable for a single Render web service instance exposing a lightweight /admin/metrics
 * snapshot for operators. Resets on restart/redeploy.
 */
@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private readonly counters: Record<MetricsCounterName, number> = COUNTER_NAMES.reduce(
    (acc, name) => ({ ...acc, [name]: 0 }),
    {} as Record<MetricsCounterName, number>,
  );

  private requestLatency: LatencyAccumulator = { sum: 0, count: 0 };
  private dashboardLoad: LatencyAccumulator & { last: number | null } = { sum: 0, count: 0, last: null };

  increment(name: MetricsCounterName, by = 1): void {
    this.counters[name] += by;
  }

  recordRequestLatency(durationMs: number): void {
    this.requestLatency.sum += durationMs;
    this.requestLatency.count += 1;
  }

  recordDashboardLoad(durationMs: number): void {
    this.dashboardLoad.sum += durationMs;
    this.dashboardLoad.count += 1;
    this.dashboardLoad.last = durationMs;
  }

  getSnapshot(): MetricsSnapshot {
    return {
      counters: { ...this.counters },
      requestLatency: {
        avgMs: average(this.requestLatency.sum, this.requestLatency.count),
        count: this.requestLatency.count,
      },
      dashboardLoadMs: {
        last: this.dashboardLoad.last,
        avg: average(this.dashboardLoad.sum, this.dashboardLoad.count),
      },
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Test/diagnostic helper — resets all counters and accumulators. */
  reset(): void {
    for (const name of COUNTER_NAMES) {
      this.counters[name] = 0;
    }
    this.requestLatency = { sum: 0, count: 0 };
    this.dashboardLoad = { sum: 0, count: 0, last: null };
  }
}

function average(sum: number, count: number): number {
  if (count === 0) {
    return 0;
  }
  return Math.round((sum / count) * 100) / 100;
}
