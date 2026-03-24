import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolSlotsModule } from '@/patrol-slots/patrol-slots.module';
import { PatrolAlertsModule } from '@/patrol-alerts/patrol-alerts.module';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Site, PatrolSchedule]),
    PatrolSlotsModule,
    PatrolAlertsModule,
  ],
  providers: [ComplianceService],
  controllers: [ComplianceController],
  exports: [ComplianceService],
})
export class ComplianceModule {}
