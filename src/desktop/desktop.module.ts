import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectorsModule } from '@/collectors/collectors.module';
import { Company } from '@/companies/entities/company.entity';
import { LicensingModule } from '@/licensing/licensing.module';
import { PatrolGroupsModule } from '@/patrol-groups/patrol-groups.module';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { User } from '@/users/entities/user.entity';
import { DesktopController } from './desktop.controller';
import { DesktopService } from './desktop.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Company, User, PatrolSchedule]),
    LicensingModule,
    CollectorsModule,
    PatrolGroupsModule,
  ],
  controllers: [DesktopController],
  providers: [DesktopService],
  exports: [DesktopService],
})
export class DesktopModule {}
