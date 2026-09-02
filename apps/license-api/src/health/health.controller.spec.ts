import { HealthController } from './health.controller';

describe('HealthController', () => {
  function buildController(overrides: {
    queryRawImpl?: () => Promise<unknown>;
    redisEnabled?: boolean;
    smtpConfigured?: boolean;
  } = {}) {
    const prisma = {
      $queryRaw: jest.fn(overrides.queryRawImpl ?? (async () => [{ '?column?': 1 }])),
      notificationLog: { count: jest.fn().mockResolvedValue(3) },
    };
    const queueService = {
      isRedisEnabled: jest.fn().mockReturnValue(overrides.redisEnabled ?? false),
      getMode: jest.fn().mockReturnValue(overrides.redisEnabled ? 'redis' : 'inline'),
      getQueueStats: jest.fn().mockResolvedValue([
        { name: 'email', waiting: 0, active: 0, failed: 0, delayed: 0, mode: 'inline' },
      ]),
    };
    const emailProvider = {
      getSafeStatus: jest.fn().mockReturnValue({
        configured: overrides.smtpConfigured ?? false,
        host: null,
        port: null,
        secure: null,
        fromName: null,
        fromEmail: null,
      }),
    };

    const controller = new HealthController(prisma as never, queueService as never, emailProvider as never);
    return { controller, prisma, queueService, emailProvider };
  }

  it('live returns status ok with a non-negative uptime', () => {
    const { controller } = buildController();
    const result = controller.live();
    expect(result.status).toBe('ok');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  it('ready reports ok when the database check succeeds', async () => {
    const { controller } = buildController();
    const result = await controller.ready();

    expect(result.status).toBe('ok');
    expect(result.checks.database).toBe(true);
    expect(result.checks.redis.connected).toBe(false);
    expect(result.checks.queue.mode).toBe('inline');
    expect(Array.isArray(result.queues)).toBe(true);
  });

  it('ready reports degraded when the database check throws', async () => {
    const { controller } = buildController({
      queryRawImpl: async () => {
        throw new Error('connection refused');
      },
    });
    const result = await controller.ready();

    expect(result.status).toBe('degraded');
    expect(result.checks.database).toBe(false);
  });

  it('ready reflects SMTP configured state', async () => {
    const { controller } = buildController({ smtpConfigured: true });
    const result = await controller.ready();
    expect(result.checks.smtp.configured).toBe(true);
  });

  it('startup returns version/build/environment metadata and pending email count', async () => {
    const { controller } = buildController();
    const result = await controller.startup();

    expect(result).toMatchObject({
      version: expect.any(String),
      buildNumber: expect.any(String),
      environment: expect.any(String),
      pendingEmails: 3,
    });
    expect(Array.isArray(result.queues)).toBe(true);
  });

  it('never leaks SMTP credentials or connection strings in any response', async () => {
    const { controller } = buildController({ smtpConfigured: true });
    const [live, ready, startup] = await Promise.all([
      Promise.resolve(controller.live()),
      controller.ready(),
      controller.startup(),
    ]);
    const serialized = JSON.stringify({ live, ready, startup });
    expect(serialized).not.toMatch(/password|SMTP_PASSWORD|redis:\/\/.*:.*@/i);
  });
});
