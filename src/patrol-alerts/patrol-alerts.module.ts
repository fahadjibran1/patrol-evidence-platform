import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolAlert } from './entities/patrol-alert.entity';
import { PatrolAlertsService } from './patrol-alerts.service';
import { PatrolAlertsController } from './patrol-alerts.controller';
import { SitesModule } from '@/sites/sites.module';

@Module({
  imports: [TypeOrmModule.forFeature([PatrolAlert]), SitesModule],
  providers: [PatrolAlertsService],
  controllers: [PatrolAlertsController],
  exports: [PatrolAlertsService, TypeOrmModule],
})
export class PatrolAlertsModule {}
