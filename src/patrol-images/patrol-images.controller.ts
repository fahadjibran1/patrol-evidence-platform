import {
  BadRequestException,
  Body,
  Controller,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Express, Response } from 'express';
import { createReadStream } from 'fs';
import { PatrolImagesService } from './patrol-images.service';
import { CreatePatrolImageDto } from './dto/create-patrol-image.dto';
import { PatrolImage } from './entities/patrol-image.entity';
import { ManualIngestDto } from './dto/manual-ingest.dto';
import { PatrolImageIngestionService } from './patrol-image-ingestion.service';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enum';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';

@Controller('patrol-images')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PatrolImagesController {
  constructor(
    private readonly patrolImagesService: PatrolImagesService,
    private readonly patrolImageIngestionService: PatrolImageIngestionService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN, UserRole.GUARD)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('siteId') siteId?: string,
    @Query('siteCode') siteCode?: string,
    @Query('date') date?: string,
    @Query('hour') hour?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<PatrolImage[]> {
    return this.patrolImagesService.findAll(user, {
      siteId,
      siteCode,
      date,
      hour,
      includeArchived: includeArchived === 'true' || includeArchived === '1',
    });
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN, UserRole.GUARD)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreatePatrolImageDto, @CurrentUser() user: AuthenticatedUser): Promise<PatrolImage> {
    try {
      if (!dto.patrolDate?.trim()) {
        throw new BadRequestException('patrolDate is required');
      }

      return await this.patrolImagesService.create(dto, user);
    } catch (error) {
      this.rethrowIfHttpException(error);
      throw error;
    }
  }

  @Post('manual-ingest')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN, UserRole.GUARD)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async manualIngest(
    @Body() dto: ManualIngestDto,
    @CurrentUser() user: AuthenticatedUser,
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
    try {
      if (!dto.siteCode?.trim()) {
        throw new BadRequestException('siteCode is required');
      }

      if (!dto.timestamp?.trim()) {
        throw new BadRequestException('timestamp is required');
      }

      const ext = (file.originalname.split('.').pop() || '').toLowerCase();
      if (!['jpg', 'jpeg', 'png'].includes(ext)) {
        throw new BadRequestException('Only jpg, jpeg, and png files are allowed');
      }

      return await this.patrolImageIngestionService.ingestPatrolImage(
        {
          collectorType: CollectorType.MANUAL,
          siteCode: dto.siteCode.trim(),
          timestamp: dto.timestamp.trim(),
          senderName: dto.senderName?.trim(),
          originalFileName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          fileBuffer: file.buffer,
        },
        user,
      );
    } catch (error) {
      this.rethrowIfHttpException(error);
      throw error;
    }
  }

  @Get(':id/content')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN, UserRole.GUARD)
  async content(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const image = await this.patrolImagesService.findOne(id, user);

    response.setHeader('Content-Type', image.mimeType);
    response.setHeader('Content-Disposition', `inline; filename="${image.storedFileName}"`);

    return new StreamableFile(createReadStream(image.filePath));
  }

  private rethrowIfHttpException(error: unknown): void {
    if (error instanceof BadRequestException) {
      throw error;
    }
  }
}
