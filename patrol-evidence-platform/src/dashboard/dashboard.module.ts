import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Site } from '@/sites/entities/site.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolAlert } from '@/patrol-alerts/entities/patrol-alert.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Site, PatrolSlot, PatrolAlert, PatrolImage])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
