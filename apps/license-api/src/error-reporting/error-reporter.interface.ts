export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';

export interface ReportedErrorContext {
  requestId?: string;
  correlationId?: string;
  userId?: string;
  organisationId?: string;
  route?: string;
  extra?: Record<string, unknown>;
}

export interface ErrorReporter {
  readonly name: string;
  captureException(error: unknown, context?: ReportedErrorContext): Promise<void> | void;
  captureMessage(message: string, severity?: ErrorSeverity, context?: ReportedErrorContext): Promise<void> | void;
}

export const ERROR_REPORTER = Symbol('ERROR_REPORTER');
