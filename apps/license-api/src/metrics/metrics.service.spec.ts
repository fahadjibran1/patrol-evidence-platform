import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  function buildService(): MetricsService {
    return new MetricsService();
  }

  it('starts all counters at zero', () => {
    const service = buildService();
    const snapshot = service.getSnapshot();
    expect(snapshot.counters).toEqual({
      requests: 0,
      emailsSent: 0,
      emailsFailed: 0,
      renewals: 0,
      licenceIssues: 0,
      loginFailures: 0,
      stripeCheckoutCreated: 0,
      stripeCheckoutCompleted: 0,
      stripeWebhookReceived: 0,
      stripeWebhookFailed: 0,
      stripeWebhookDeadLetter: 0,
      stripePaymentSucceeded: 0,
      stripePaymentFailed: 0,
      stripeReconciliationMismatch: 0,
    });
  });

  it('increments named counters', () => {
    const service = buildService();
    service.increment('requests');
    service.increment('requests');
    service.increment('emailsSent', 3);

    const snapshot = service.getSnapshot();
    expect(snapshot.counters.requests).toBe(2);
    expect(snapshot.counters.emailsSent).toBe(3);
  });

  it('tracks average request latency', () => {
    const service = buildService();
    service.recordRequestLatency(100);
    service.recordRequestLatency(200);

    const snapshot = service.getSnapshot();
    expect(snapshot.requestLatency.count).toBe(2);
    expect(snapshot.requestLatency.avgMs).toBe(150);
  });

  it('tracks last and average dashboard load time', () => {
    const service = buildService();
    service.recordDashboardLoad(50);
    service.recordDashboardLoad(150);

    const snapshot = service.getSnapshot();
    expect(snapshot.dashboardLoadMs.last).toBe(150);
    expect(snapshot.dashboardLoadMs.avg).toBe(100);
  });

  it('reset() clears counters and latency accumulators', () => {
    const service = buildService();
    service.increment('requests', 5);
    service.recordRequestLatency(100);
    service.recordDashboardLoad(100);

    service.reset();

    const snapshot = service.getSnapshot();
    expect(snapshot.counters.requests).toBe(0);
    expect(snapshot.requestLatency.count).toBe(0);
    expect(snapshot.dashboardLoadMs.last).toBeNull();
  });

  it('reports a non-negative uptime', () => {
    const service = buildService();
    const snapshot = service.getSnapshot();
    expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
