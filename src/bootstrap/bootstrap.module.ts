import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectorsModule } from '@/collectors/collectors.module';
import { PatrolGroupsModule } from '@/patrol-groups/patrol-groups.module';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { Site } from '@/sites/entities/site.entity';
import { PlatformBootstrapService } from './platform-bootstrap.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Site, PatrolSchedule]),
    PatrolGroupsModule,
    CollectorsModule,
  ],
  providers: [PlatformBootstrapService],
  exports: [PlatformBootstrapService],
})
export class BootstrapModule {}
