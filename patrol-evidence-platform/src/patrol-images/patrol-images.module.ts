import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatrolImage } from './entities/patrol-image.entity';
import { PatrolImagesService } from './patrol-images.service';
import { PatrolImagesController } from './patrol-images.controller';
import { ComplianceModule } from '@/compliance/compliance.module';
import { PatrolImageIngestionService } from './patrol-image-ingestion.service';
import { Site } from '@/sites/entities/site.entity';
import { StorageModule } from '@/storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([PatrolImage, Site]), ComplianceModule, StorageModule],
  providers: [PatrolImagesService, PatrolImageIngestionService],
  controllers: [PatrolImagesController],
  exports: [PatrolImagesService, PatrolImageIngestionService, TypeOrmModule],
})
export class PatrolImagesModule {}
