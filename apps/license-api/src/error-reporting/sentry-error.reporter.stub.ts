/**
 * Future Sentry adapter stub — do not import @sentry/* until configured.
 * Replace ConsoleErrorReporter via ERROR_REPORTING_PROVIDER=sentry when ready.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  ErrorReporter,
  ErrorSeverity,
  ReportedErrorContext,
} from './error-reporter.interface';

@Injectable()
export class SentryErrorReporterStub implements ErrorReporter {
  readonly name = 'sentry-stub';
  private readonly logger = new Logger('SentryErrorReporterStub');

  captureException(error: unknown, context?: ReportedErrorContext): void {
    this.logger.warn(
      `Sentry not configured — dropped exception: ${error instanceof Error ? error.message : String(error)} ` +
        `(correlationId=${context?.correlationId ?? 'n/a'})`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  captureMessage(message: string, severity: ErrorSeverity = 'info', context?: ReportedErrorContext): void {
    this.logger.warn(`Sentry not configured — dropped ${severity}: ${message}`);
  }
}
