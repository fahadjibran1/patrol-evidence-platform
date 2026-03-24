import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolSchedule } from './entities/patrol-schedule.entity';
import { PatrolSchedulesService } from './patrol-schedules.service';
import { PatrolSchedulesController } from './patrol-schedules.controller';
import { SitesModule } from '@/sites/sites.module';

@Module({
  imports: [TypeOrmModule.forFeature([PatrolSchedule]), SitesModule],
  providers: [PatrolSchedulesService],
  controllers: [PatrolSchedulesController],
  exports: [PatrolSchedulesService, TypeOrmModule],
})
export class PatrolSchedulesModule {}
