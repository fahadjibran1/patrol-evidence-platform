import { Inject, Injectable } from '@nestjs/common';
import {
  ERROR_REPORTER,
  ErrorReporter,
  ErrorSeverity,
  ReportedErrorContext,
} from './error-reporter.interface';

/** Application façade — never import vendor SDKs from feature modules. */
@Injectable()
export class ErrorReportingService {
  constructor(@Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter) {}

  get providerName(): string {
    return this.reporter.name;
  }

  captureException(error: unknown, context?: ReportedErrorContext): void {
    void this.reporter.captureException(error, context);
  }

  captureMessage(message: string, severity?: ErrorSeverity, context?: ReportedErrorContext): void {
    void this.reporter.captureMessage(message, severity, context);
  }
}
