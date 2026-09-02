import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { ActivateLicenseDto } from './dto/activate-license.dto';
import { CreateLicenceRequestFileDto, ImportLicenceDto } from './dto/commercial-licence.dto';
import { LicenseService } from './license.service';

@Controller('license')
export class LicenseController {
  constructor(private readonly licenseService: LicenseService) {}

  @Get('status')
  getStatus() {
    return this.licenseService.getStatus();
  }

  @Post('request-file')
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
  importLicence(@Body() dto: ImportLicenceDto) {
    try {
      return this.licenseService.importCommercialLicence(dto.licenceFileContents);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Licence import failed.');
    }
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
