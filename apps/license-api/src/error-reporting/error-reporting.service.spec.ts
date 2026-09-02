import { ConsoleErrorReporter } from './console-error.reporter';
import { ErrorReportingService } from './error-reporting.service';

describe('ErrorReportingService', () => {
  it('delegates to the injected reporter without throwing', () => {
    const reporter = new ConsoleErrorReporter();
    const service = new ErrorReportingService(reporter);
    expect(service.providerName).toBe('console');
    expect(() => service.captureException(new Error('boom'), { correlationId: 'c1' })).not.toThrow();
    expect(() => service.captureMessage('hello', 'warning')).not.toThrow();
  });

  it('redacts sensitive context keys in console reporter', () => {
    const reporter = new ConsoleErrorReporter();
    const errorSpy = jest.spyOn((reporter as any).logger, 'error').mockImplementation(() => undefined);
    reporter.captureException(new Error('x'), {
      extra: { password: 'secret', safe: 'ok' },
    });
    expect(errorSpy).toHaveBeenCalled();
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain('[redacted]');
    expect(logged).not.toContain('secret');
    errorSpy.mockRestore();
  });
});
