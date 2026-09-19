import { Body, Controller, Get, Headers, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { DesktopApiGuard } from '@/security/desktop-api.guard';
import { DesktopInitializedMutationGuard } from '@/security/desktop-initialized-mutation.guard';
import { DesktopRecoveryService } from '@/security/desktop-recovery.service';
import { AuthorizeDesktopRecoveryDto } from './dto/authorize-desktop-recovery.dto';
import { DesktopService } from './desktop.service';
import { InitializeDesktopWorkspaceDto } from './dto/initialize-desktop-workspace.dto';
import { ResetDesktopAdminPasswordDto } from './dto/reset-desktop-admin-password.dto';
import { UpdateDesktopLicenseDto } from './dto/update-desktop-license.dto';
import { VerifyDesktopSetupDto } from './dto/verify-desktop-setup.dto';
import { WhatsAppCollectorService } from '@/collectors/whatsapp-collector.service';

// Shared with the Electron parent without duplicating the cryptographic contract.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createIdentityResponse } = require('../../desktop/backend-identity.js') as {
  createIdentityResponse: (secret: string, payload: Record<string, unknown>) => Record<string, unknown>;
};

@Controller('desktop/bootstrap')
@UseGuards(DesktopApiGuard)
export class DesktopController {
  constructor(
    private readonly desktopService: DesktopService,
    private readonly desktopRecoveryService: DesktopRecoveryService,
    private readonly whatsAppCollectorService: WhatsAppCollectorService,
  ) {}

  @Get('status')
  getStatus() {
    return this.desktopService.getBootstrapStatus();
  }

  @Get('runtime-identity')
  getRuntimeIdentity(@Headers('x-patrolsafe-backend-challenge') challenge: string | undefined) {
    const secret = process.env.PATROLSAFE_DESKTOP_API_TOKEN?.trim();
    const sessionId = process.env.PATROLSAFE_DESKTOP_BACKEND_SESSION?.trim();
    const normalizedChallenge = challenge?.trim();
    if (!secret || !sessionId || !normalizedChallenge || normalizedChallenge.length < 16) {
      throw new ServiceUnavailableException('Desktop backend identity is unavailable');
    }

    return createIdentityResponse(secret, {
      appVersion: process.env.PATROLSAFE_APP_VERSION ?? 'development',
      buildId: process.env.PATROLSAFE_BUILD_ID ?? 'development',
      processId: process.pid,
      sessionId,
      challenge: normalizedChallenge,
    });
  }

  @Post('runtime-verified')
  confirmRuntimeVerified() {
    return this.whatsAppCollectorService.confirmDesktopBackendIdentityVerified();
  }

  @Post('initialize')
  @UseGuards(DesktopInitializedMutationGuard)
  initialize(@Body() dto: InitializeDesktopWorkspaceDto) {
    return this.desktopService.initializeWorkspace(dto);
  }

  @Post('complete-setup')
  @UseGuards(JwtAuthGuard)
  completeSetup() {
    return this.desktopService.completeSetup();
  }

  @Post('verify-setup')
  @UseGuards(JwtAuthGuard)
  verifySetup(@Body() dto: VerifyDesktopSetupDto) {
    return this.desktopService.verifySetupConfiguration(dto);
  }

  @Post('license')
  @UseGuards(JwtAuthGuard)
  updateLicense(@Body() dto: UpdateDesktopLicenseDto) {
    return this.desktopService.updateLicense(dto);
  }

  @Post('reset-admin-password')
  resetAdminPassword(
    @Headers('x-patrolsafe-recovery-token') recoveryToken: string | undefined,
    @Body() dto: ResetDesktopAdminPasswordDto,
  ) {
    this.desktopRecoveryService.consume(recoveryToken);
    return this.desktopService.resetAdminPassword(dto);
  }

  @Post('recovery/authorize')
  authorizeRecovery(
    @Headers('x-patrolsafe-recovery-authority') authority: string | undefined,
    @Body() dto: AuthorizeDesktopRecoveryDto,
  ) {
    return this.desktopRecoveryService.authorize(authority, dto.token);
  }
}
