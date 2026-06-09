import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site } from './entities/site.entity';
import { SitesService } from './sites.service';
import { SitesController } from './sites.controller';
import { Company } from '@/companies/entities/company.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Site, Company])],
  providers: [SitesService],
  controllers: [SitesController],
  exports: [SitesService, TypeOrmModule],
})
export class SitesModule {}
