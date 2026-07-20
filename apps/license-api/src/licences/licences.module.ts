import { Module } from '@nestjs/common';
import { LicencesController } from './licences.controller';
import { LicencesService } from './licences.service';

@Module({
  controllers: [LicencesController],
  providers: [LicencesService],
  exports: [LicencesService],
})
export class LicencesModule {}
