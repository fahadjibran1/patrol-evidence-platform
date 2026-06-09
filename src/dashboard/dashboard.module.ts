import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolAlert } from '@/patrol-alerts/entities/patrol-alert.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { Site } from '@/sites/entities/site.entity';
import { User } from '@/users/entities/user.entity';
import { GuardSenderMapping } from './entities/guard-sender-mapping.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Site,
      PatrolSlot,
      PatrolImage,
      PatrolAlert,
      PatrolGroup,
      PatrolSchedule,
      User,
      GuardSenderMapping,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
