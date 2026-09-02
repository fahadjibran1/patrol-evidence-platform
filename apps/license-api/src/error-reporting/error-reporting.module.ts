import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_REPORTER } from './error-reporter.interface';
import { ConsoleErrorReporter } from './console-error.reporter';
import { SentryErrorReporterStub } from './sentry-error.reporter.stub';
import { ErrorReportingService } from './error-reporting.service';

@Global()
@Module({
  providers: [
    ConsoleErrorReporter,
    SentryErrorReporterStub,
    {
      provide: ERROR_REPORTER,
      inject: [ConfigService, ConsoleErrorReporter, SentryErrorReporterStub],
      useFactory: (
        config: ConfigService,
        consoleReporter: ConsoleErrorReporter,
        sentryStub: SentryErrorReporterStub,
      ) => {
        const provider = (config.get<string>('ERROR_REPORTING_PROVIDER') ?? 'console').toLowerCase();
        if (provider === 'sentry') {
          return sentryStub;
        }
        return consoleReporter;
      },
    },
    ErrorReportingService,
  ],
  exports: [ERROR_REPORTER, ErrorReportingService],
})
export class ErrorReportingModule {}
