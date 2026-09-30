import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TokenService } from './token.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AdminMfaCryptoService } from './admin-mfa-crypto.service';
import { AdminMfaService } from './admin-mfa.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, AdminMfaCryptoService, AdminMfaService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, TokenService, AdminMfaService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
