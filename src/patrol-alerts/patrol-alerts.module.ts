import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolAlert } from './entities/patrol-alert.entity';
import { PatrolAlertsService } from './patrol-alerts.service';

@Module({
  imports: [TypeOrmModule.forFeature([PatrolAlert])],
  providers: [PatrolAlertsService],
  exports: [PatrolAlertsService, TypeOrmModule],
})
export class PatrolAlertsModule {}
