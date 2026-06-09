import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from './entities/incident.entity';
import { IncidentsService } from './incidents.service';
import { IncidentsController } from './incidents.controller';
import { SitesModule } from '@/sites/sites.module';

@Module({
  imports: [TypeOrmModule.forFeature([Incident]), SitesModule],
  providers: [IncidentsService],
  controllers: [IncidentsController],
})
export class IncidentsModule {}
