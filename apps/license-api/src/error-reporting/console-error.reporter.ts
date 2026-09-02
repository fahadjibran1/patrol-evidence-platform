import { Injectable, Logger } from '@nestjs/common';
import {
  ErrorReporter,
  ErrorSeverity,
  ReportedErrorContext,
} from './error-reporter.interface';
import { redactSensitiveFields } from '@/common/interceptors/request-logging.interceptor';

/** Default reporter — structured console logs only. Swap for Sentry/Azure/Datadog later. */
@Injectable()
export class ConsoleErrorReporter implements ErrorReporter {
  readonly name = 'console';
  private readonly logger = new Logger('ErrorReporter');

  captureException(error: unknown, context?: ReportedErrorContext): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(
      JSON.stringify(
        redactSensitiveFields({
          type: 'exception',
          message: err.message,
          name: err.name,
          stack: err.stack,
          context: context ?? {},
        }),
      ),
    );
  }

  captureMessage(message: string, severity: ErrorSeverity = 'info', context?: ReportedErrorContext): void {
    const payload = JSON.stringify(
      redactSensitiveFields({ type: 'message', severity, message, context: context ?? {} }),
    );
    if (severity === 'fatal' || severity === 'error') {
      this.logger.error(payload);
    } else if (severity === 'warning') {
      this.logger.warn(payload);
    } else {
      this.logger.log(payload);
    }
  }
}
