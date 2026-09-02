import { QueueService } from './queue.service';
import { QUEUE_NAMES } from './queue.constants';
import type { EmailJobPayload, EmailJobResult } from './queue.types';

describe('QueueService (inline mode)', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    delete process.env.REDIS_URL;
  });

  afterAll(() => {
    if (originalRedisUrl) {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  function buildService(): QueueService {
    const configService = { get: jest.fn().mockReturnValue(undefined) };
    return new QueueService(configService as never);
  }

  it('reports Redis as disabled and mode as inline when REDIS_URL is unset', async () => {
    const service = buildService();
    await service.onModuleInit();

    expect(service.isRedisEnabled()).toBe(false);
    expect(service.getMode()).toBe('inline');
  });

  it('runs the registered EMAIL processor synchronously and returns its result', async () => {
    const service = buildService();
    await service.onModuleInit();

    const processor = jest.fn(async (payload: EmailJobPayload): Promise<EmailJobResult> => ({
      success: true,
      logId: payload.notificationLogId,
      status: 'SENT',
    }));
    service.registerProcessor(QUEUE_NAMES.EMAIL, processor);

    const result = await service.enqueueEmail({ notificationLogId: 'log-1' });

    expect(processor).toHaveBeenCalledWith(expect.objectContaining({ notificationLogId: 'log-1' }));
    expect(result).toEqual({ success: true, logId: 'log-1', status: 'SENT' });
  });

  it('returns a FAILED-shaped result when no processor has been registered yet', async () => {
    const service = buildService();
    await service.onModuleInit();

    const result = await service.enqueueEmail({ notificationLogId: 'log-2' });

    expect(result.success).toBe(false);
    expect(result.logId).toBe('log-2');
  });

  it('surfaces processor errors from enqueueEmail rather than swallowing them silently', async () => {
    const service = buildService();
    await service.onModuleInit();
    service.registerProcessor(QUEUE_NAMES.EMAIL, async () => {
      throw new Error('boom');
    });

    await expect(service.enqueueEmail({ notificationLogId: 'log-3' })).rejects.toThrow('boom');
  });

  it('getQueueStats returns zeroed stats for all known queues in inline mode', async () => {
    const service = buildService();
    await service.onModuleInit();

    const stats = await service.getQueueStats();
    expect(stats).toHaveLength(5);
    expect(stats.every((s) => s.mode === 'inline')).toBe(true);
    expect(stats.every((s) => s.waiting === 0 && s.active === 0 && s.failed === 0 && s.delayed === 0)).toBe(true);
    expect(stats.map((s) => s.name).sort()).toEqual(
      [
        QUEUE_NAMES.EMAIL,
        QUEUE_NAMES.MAINTENANCE,
        QUEUE_NAMES.NOTIFICATIONS,
        QUEUE_NAMES.REPORTS,
        QUEUE_NAMES.STRIPE_WEBHOOKS,
      ].sort(),
    );
  });

  it('onModuleDestroy resolves cleanly with no Redis connection', async () => {
    const service = buildService();
    await service.onModuleInit();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
