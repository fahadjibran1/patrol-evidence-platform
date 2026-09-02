import { of, throwError } from 'rxjs';
import { RequestLoggingInterceptor, redactSensitiveFields } from './request-logging.interceptor';

describe('redactSensitiveFields', () => {
  it('redacts top-level keys matching the sensitive pattern', () => {
    const result = redactSensitiveFields({
      password: 'hunter2',
      token: 'abc',
      secret: 'xyz',
      tg1: 'TG1.payload.sig',
      fullLicenseKey: 'TG1.payload.sig',
      smtpPassword: 'pw',
      authorization: 'Bearer abc',
      jwt: 'abc.def.ghi',
      username: 'alice',
    });

    expect(result).toEqual({
      password: '[redacted]',
      token: '[redacted]',
      secret: '[redacted]',
      tg1: '[redacted]',
      fullLicenseKey: '[redacted]',
      smtpPassword: '[redacted]',
      authorization: '[redacted]',
      jwt: '[redacted]',
      username: 'alice',
    });
  });

  it('recurses into nested objects and arrays', () => {
    const result = redactSensitiveFields({
      body: { password: 'hunter2', nested: { token: 'abc' } },
      items: [{ secret: '1' }, { ok: true }],
    });

    expect(result).toEqual({
      body: { password: '[redacted]', nested: { token: '[redacted]' } },
      items: [{ secret: '[redacted]' }, { ok: true }],
    });
  });

  it('leaves primitives and null/undefined untouched', () => {
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields('hello')).toBe('hello');
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(undefined)).toBeUndefined();
  });
});

describe('RequestLoggingInterceptor', () => {
  function buildContext(overrides: Record<string, unknown> = {}) {
    const request: Record<string, unknown> = {
      method: 'POST',
      url: '/admin/licences',
      headers: { 'user-agent': 'jest-test', 'x-correlation-id': 'corr-123' },
      ip: '127.0.0.1',
      admin: { sub: 'admin-1', role: 'ADMIN' },
      ...overrides,
    };
    const response = { statusCode: 200 };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    };
    return { context, request, response };
  }

  it('attaches a requestId and correlationId (from header) to the request', async () => {
    const { context, request } = buildContext();
    const interceptor = new RequestLoggingInterceptor();
    const handler = { handle: () => of({ ok: true }) };

    await new Promise<void>((resolve) => {
      interceptor.intercept(context as never, handler as never).subscribe(() => resolve());
    });

    expect(request.correlationId).toBe('corr-123');
    expect(request.requestId).toBeDefined();
  });

  it('generates a correlationId when no header is present', async () => {
    const { context, request } = buildContext({ headers: { 'user-agent': 'jest-test' } });
    const interceptor = new RequestLoggingInterceptor();
    const handler = { handle: () => of({ ok: true }) };

    await new Promise<void>((resolve) => {
      interceptor.intercept(context as never, handler as never).subscribe(() => resolve());
    });

    expect(request.correlationId).toBeDefined();
    expect(typeof request.correlationId).toBe('string');
  });

  it('logs a structured entry with redacted fields and increments metrics on success', async () => {
    const metricsService = { increment: jest.fn(), recordRequestLatency: jest.fn() };
    const { context } = buildContext();
    const interceptor = new RequestLoggingInterceptor(metricsService as never);
    const logSpy = jest.spyOn((interceptor as unknown as { logger: { log: jest.Mock } }).logger, 'log');
    const handler = { handle: () => of({ ok: true }) };

    await new Promise<void>((resolve) => {
      interceptor.intercept(context as never, handler as never).subscribe(() => resolve());
    });

    expect(metricsService.increment).toHaveBeenCalledWith('requests');
    expect(metricsService.recordRequestLatency).toHaveBeenCalledWith(expect.any(Number));
    expect(logSpy).toHaveBeenCalledTimes(1);

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      method: 'POST',
      statusCode: 200,
      userId: 'admin-1',
      companyId: null,
      role: 'ADMIN',
      ip: '127.0.0.1',
      userAgent: 'jest-test',
    });
  });

  it('still logs on error responses with the error status code', async () => {
    const { context } = buildContext();
    const interceptor = new RequestLoggingInterceptor();
    const logSpy = jest.spyOn((interceptor as unknown as { logger: { log: jest.Mock } }).logger, 'log');
    const handler = { handle: () => throwError(() => ({ status: 403 })) };

    await new Promise<void>((resolve) => {
      interceptor.intercept(context as never, handler as never).subscribe({ error: () => resolve() });
    });

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.statusCode).toBe(403);
  });
});
