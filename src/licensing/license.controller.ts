import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { DesktopApiGuard } from '@/security/desktop-api.guard';
import { ActivateLicenseDto } from './dto/activate-license.dto';
import { CreateLicenceRequestFileDto, ImportLicenceDto } from './dto/commercial-licence.dto';
import { LicenseService } from './license.service';

@Controller('license')
@UseGuards(DesktopApiGuard)
export class LicenseController {
  constructor(private readonly licenseService: LicenseService) {}

  @Get('status')
  getStatus() {
    return this.licenseService.getStatus();
  }

  @Post('request-file')
  @UseGuards(JwtAuthGuard)
  createRequestFile(@Body() dto: CreateLicenceRequestFileDto) {
    try {
      return this.licenseService.createRequestFile({
        companyName: dto.companyName,
        requestedPlan: dto.requestedPlan,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Could not create request file.');
    }
  }

  @Post('import')
  @UseGuards(JwtAuthGuard)
  importLicence(@Body() dto: ImportLicenceDto) {
    try {
      return this.licenseService.importCommercialLicence(dto.licenceFileContents);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Licence import failed.');
    }
  }

  @Post('activate')
  @UseGuards(JwtAuthGuard)
  activate(@Body() dto: ActivateLicenseDto) {
    try {
      return this.licenseService.activateLicense(dto.licenseKey);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Licence activation failed.');
    }
  }

  @Post('deactivate')
  @UseGuards(JwtAuthGuard)
  deactivate() {
    return this.licenseService.deactivateLicense();
  }
}
