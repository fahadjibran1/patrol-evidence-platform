import { Body, Controller, Get, Post } from '@nestjs/common';
import { DesktopService } from './desktop.service';
import { InitializeDesktopWorkspaceDto } from './dto/initialize-desktop-workspace.dto';
import { ResetDesktopAdminPasswordDto } from './dto/reset-desktop-admin-password.dto';
import { UpdateDesktopLicenseDto } from './dto/update-desktop-license.dto';
import { VerifyDesktopSetupDto } from './dto/verify-desktop-setup.dto';

@Controller('desktop/bootstrap')
export class DesktopController {
  constructor(private readonly desktopService: DesktopService) {}

  @Get('status')
  getStatus() {
    return this.desktopService.getBootstrapStatus();
  }

  @Post('initialize')
  initialize(@Body() dto: InitializeDesktopWorkspaceDto) {
    return this.desktopService.initializeWorkspace(dto);
  }

  @Post('complete-setup')
  completeSetup() {
    return this.desktopService.completeSetup();
  }

  @Post('verify-setup')
  verifySetup(@Body() dto: VerifyDesktopSetupDto) {
    return this.desktopService.verifySetupConfiguration(dto);
  }

  @Post('license')
  updateLicense(@Body() dto: UpdateDesktopLicenseDto) {
    return this.desktopService.updateLicense(dto);
  }

  @Post('reset-admin-password')
  resetAdminPassword(@Body() dto: ResetDesktopAdminPasswordDto) {
    return this.desktopService.resetAdminPassword(dto);
  }
}
