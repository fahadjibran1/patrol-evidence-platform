import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { ActivateLicenseDto } from './dto/activate-license.dto';
import { LicenseService } from './license.service';

@Controller('license')
export class LicenseController {
  constructor(private readonly licenseService: LicenseService) {}

  @Get('status')
  getStatus() {
    return this.licenseService.getStatus();
  }

  @Post('activate')
  activate(@Body() dto: ActivateLicenseDto) {
    try {
      return this.licenseService.activateLicense(dto.licenseKey);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Licence activation failed.');
    }
  }

  @Post('deactivate')
  deactivate() {
    return this.licenseService.deactivateLicense();
  }
}
