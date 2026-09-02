import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/validate-env';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';
import { SigningModule } from './signing/signing.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AdminsModule } from './admins/admins.module';
import { CustomersModule } from './customers/customers.module';
import { LicencesModule } from './licences/licences.module';
import { PaymentsModule } from './payments/payments.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { DomainEventsModule } from './domain-events/domain-events.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { ExportsModule } from './exports/exports.module';
import { SystemModule } from './system/system.module';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { CustomerAuthModule } from './customer-auth/customer-auth.module';
import { CustomerDashboardModule } from './customer-dashboard/customer-dashboard.module';
import { CustomerLicencesModule } from './customer-licences/customer-licences.module';
import { CustomerDownloadsModule } from './customer-downloads/customer-downloads.module';
import { CustomerProfileModule } from './customer-profile/customer-profile.module';
import { CustomerNotificationsModule } from './customer-notifications/customer-notifications.module';
import { CustomerOrgModule } from './customer-org/customer-org.module';
import { BillingModule } from './billing/billing.module';
import { ErrorReportingModule } from './error-reporting/error-reporting.module';
import { SupportOpsModule } from './support-ops/support-ops.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    CryptoModule,
    SigningModule,
    AuditModule,
    AuthModule,
    MetricsModule,
    ErrorReportingModule,
    DomainEventsModule,
    QueueModule,
    AdminsModule,
    CustomersModule,
    LicencesModule,
    PaymentsModule,
    BillingModule,
    SupportOpsModule,
    DashboardModule,
    SettingsModule,
    NotificationsModule,
    HealthModule,
    ExportsModule,
    SystemModule,
    CustomerAuthModule,
    CustomerDashboardModule,
    CustomerLicencesModule,
    CustomerDownloadsModule,
    CustomerProfileModule,
    CustomerNotificationsModule,
    CustomerOrgModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
  ],
})
export class AppModule {}
