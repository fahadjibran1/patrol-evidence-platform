import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site } from './entities/site.entity';
import { SitesService } from './sites.service';
import { SitesController } from './sites.controller';
import { Company } from '@/companies/entities/company.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Site, Company, PatrolGroup, PatrolSchedule, PatrolImage, PatrolSlot])],
  providers: [SitesService],
  controllers: [SitesController],
  exports: [SitesService, TypeOrmModule],
})
export class SitesModule {}
