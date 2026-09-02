import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { SigningService } from '@/signing/signing.service';
import { EmailProvider } from '@/notifications/providers/email.provider';

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly signingService: SigningService,
    private readonly emailProvider: EmailProvider,
  ) {}

  @Get('signing-key')
  getSigningKeyStatus() {
    return this.signingService.getSigningKeyStatus();
  }

  @Get('smtp')
  getSmtpStatus() {
    return this.emailProvider.getSafeStatus();
  }
}
