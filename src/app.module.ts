import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { validateEnv } from './config/validate-env';
import { HealthModule } from './health/health.module';
import { StorageModule } from './storage/storage.module';
import { SitesModule } from './sites/sites.module';
import { PatrolGroupsModule } from './patrol-groups/patrol-groups.module';
import { PatrolSchedulesModule } from './patrol-schedules/patrol-schedules.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PatrolAlertsModule } from './patrol-alerts/patrol-alerts.module';
import { PatrolImagesModule } from './patrol-images/patrol-images.module';
import { PatrolSlotsModule } from './patrol-slots/patrol-slots.module';
import { CollectorsModule } from './collectors/collectors.module';
import { ComplianceModule } from './compliance/compliance.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { OpsModule } from './ops/ops.module';
import { IncidentsModule } from './incidents/incidents.module';
import { DesktopModule } from './desktop/desktop.module';
import { LicensingModule } from './licensing/licensing.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { DesktopSecurityModule } from './security/desktop-security.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: Boolean(process.env.DESKTOP_CONFIG_PATH?.trim()),
      load: [appConfig, databaseConfig],
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...databaseConfig(),
      }),
    }),
    ScheduleModule.forRoot(),
    DesktopSecurityModule,
    AuthModule,
    UsersModule,
    HealthModule,
    StorageModule,
    SitesModule,
    PatrolGroupsModule,
    PatrolSchedulesModule,
    PatrolImagesModule,
    PatrolSlotsModule,
    PatrolAlertsModule,
    CollectorsModule,
    ComplianceModule,
    IncidentsModule,
    DashboardModule,
    OpsModule,
    LicensingModule,
    DesktopModule,
    BootstrapModule,
  ],
})
export class AppModule {}
