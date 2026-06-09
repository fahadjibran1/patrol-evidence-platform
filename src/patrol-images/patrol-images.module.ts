import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolImage } from './entities/patrol-image.entity';
import { PatrolImagesService } from './patrol-images.service';
import { PatrolImagesController } from './patrol-images.controller';
import { ComplianceModule } from '@/compliance/compliance.module';
import { PatrolImageIngestionService } from './patrol-image-ingestion.service';
import { StorageModule } from '@/storage/storage.module';
import { SitesModule } from '@/sites/sites.module';

@Module({
  imports: [TypeOrmModule.forFeature([PatrolImage]), ComplianceModule, StorageModule, SitesModule],
  providers: [PatrolImagesService, PatrolImageIngestionService],
  controllers: [PatrolImagesController],
  exports: [PatrolImagesService, PatrolImageIngestionService, TypeOrmModule],
})
export class PatrolImagesModule {}
