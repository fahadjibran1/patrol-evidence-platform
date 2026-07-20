import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
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
import { ApiExceptionFilter } from './common/filters/api-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    CryptoModule,
    SigningModule,
    AuditModule,
    AuthModule,
    AdminsModule,
    CustomersModule,
    LicencesModule,
    PaymentsModule,
    DashboardModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
})
export class AppModule {}
