import type { Express } from 'express';
import {
  BadRequestException,
  Body,
  Controller,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseInterceptors,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PatrolImagesService } from './patrol-images.service';
import { CreatePatrolImageDto } from './dto/create-patrol-image.dto';
import { PatrolImage } from './entities/patrol-image.entity';
import { ManualIngestDto } from './dto/manual-ingest.dto';
import { PatrolImageIngestionService } from './patrol-image-ingestion.service';
import { CollectorType } from '@/common/enums/collector-type.enum';

@Controller('patrol-images')
export class PatrolImagesController {
  constructor(
    private readonly patrolImagesService: PatrolImagesService,
    private readonly patrolImageIngestionService: PatrolImageIngestionService,
  ) {}

  @Post()
  create(@Body() dto: CreatePatrolImageDto): Promise<PatrolImage> {
    return this.patrolImagesService.create(dto);
  }

  @Post('manual-ingest')
  @UseInterceptors(FileInterceptor('file'))
  async manualIngest(
    @Body() dto: ManualIngestDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /image\/(jpeg|png)/i }),
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<PatrolImage> {

    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (!['jpg', 'jpeg', 'png'].includes(ext)) {
      throw new BadRequestException('Only jpg, jpeg, and png files are allowed');
    }

    return this.patrolImageIngestionService.ingestPatrolImage({
      collectorType: CollectorType.MANUAL,
      siteCode: dto.siteCode,
      timestamp: dto.timestamp,
      senderName: dto.senderName,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      fileBuffer: file.buffer,
    });
  }
}
