import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VersionService } from './version.service';

@ApiTags('system')
@Controller('system')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  /** Public platform version endpoint (no secrets). */
  @Get('version')
  getVersion() {
    return this.versionService.getVersion();
  }
}
