import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolGroup } from './entities/patrol-group.entity';
import { PatrolGroupsService } from './patrol-groups.service';
import { PatrolGroupsController } from './patrol-groups.controller';
import { SitesModule } from '@/sites/sites.module';

@Module({
  imports: [TypeOrmModule.forFeature([PatrolGroup]), SitesModule],
  providers: [PatrolGroupsService],
  controllers: [PatrolGroupsController],
  exports: [PatrolGroupsService, TypeOrmModule],
})
export class PatrolGroupsModule {}
