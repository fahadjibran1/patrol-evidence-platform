import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatrolImage } from './entities/patrol-image.entity';
import { CreatePatrolImageDto } from './dto/create-patrol-image.dto';
import { ComplianceService } from '@/compliance/compliance.service';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { SitesService } from '@/sites/sites.service';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { UserRole } from '@/common/enums/user-role.enum';
import { getPatrolTimeParts } from '@/common/utils/patrol-time.util';
import {
  dedupePatrolImagesForCount,
  filterPatrolImagesForPatrolDate,
  getPatrolDateUtcBounds,
  imagePatrolHourFromSentAt,
  isCountablePatrolImage,
  logPatrolImagesForAggregation,
} from './patrol-image-query.util';

@Injectable()
export class PatrolImagesService {
  private readonly logger = new Logger(PatrolImagesService.name);

  constructor(
    @InjectRepository(PatrolImage)
    private readonly imageRepo: Repository<PatrolImage>,
    private readonly sitesService: SitesService,
    private readonly complianceService: ComplianceService,
  ) {}

  async create(dto: CreatePatrolImageDto, user: AuthenticatedUser): Promise<PatrolImage> {
    try {
      const sentAt = this.parseRequiredDate(dto.sentAt, 'sentAt');
      const receivedAt = this.parseRequiredDate(dto.receivedAt, 'receivedAt');

      if (receivedAt < sentAt) {
        throw new BadRequestException('receivedAt must be greater than or equal to sentAt');
      }

      if (!dto.storedFileName.trim()) {
        throw new BadRequestException('storedFileName is required');
      }

      if (!dto.filePath.trim()) {
        throw new BadRequestException('filePath is required');
      }

      if (!dto.mimeType.trim()) {
        throw new BadRequestException('mimeType is required');
      }

      const site = await this.sitesService.findActiveById(dto.siteId, user);
      const patrolTime = getPatrolTimeParts(sentAt);

      const image = await this.imageRepo.save(
        this.imageRepo.create({
          ...dto,
          siteId: site.id,
          sentAt,
          receivedAt,
          patrolDate: patrolTime.date,
          patrolHour: patrolTime.hour,
          originalFileName: dto.originalFileName?.trim() || undefined,
          storedFileName: dto.storedFileName.trim(),
          filePath: dto.filePath.trim(),
          fileSize: dto.fileSize.trim(),
          mimeType: dto.mimeType.trim(),
          senderName: dto.senderName?.trim() || undefined,
          senderNumber: dto.senderNumber?.trim() || undefined,
          messageExternalId: dto.messageExternalId?.trim() || undefined,
          notes: dto.notes?.trim() || undefined,
          status: PatrolSlotStatus.PENDING,
        }),
      );

      const status = await this.complianceService.updateSlotStatusFromImage(image);

      image.status = status;
      return await this.imageRepo.save(image);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      this.logger.error('Failed to create patrol image', error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('Failed to create patrol image');
    }
  }

  async findAll(
    user: AuthenticatedUser,
    filters: {
      siteId?: string;
      siteCode?: string;
      date?: string;
      hour?: string;
    },
  ): Promise<PatrolImage[]> {
    const query = this.imageRepo
      .createQueryBuilder('image')
      .innerJoinAndSelect('image.site', 'site')
      .leftJoinAndSelect('image.group', 'group')
      .where('site.active = true')
      .orderBy('image.sentAt', 'DESC')
      .take(500);

    if (user.role !== UserRole.ADMIN) {
      query.andWhere('site.companyId = :companyId', { companyId: user.companyId });
    }

    if (filters.siteId?.trim()) {
      query.andWhere('image.siteId = :siteId', { siteId: filters.siteId.trim() });
    } else if (filters.siteCode?.trim()) {
      query.andWhere('site.siteCode = :siteCode', { siteCode: filters.siteCode.trim().toUpperCase() });
    }

    if (filters.date?.trim()) {
      const selectedDate = filters.date.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(selectedDate)) {
        throw new BadRequestException('date must use YYYY-MM-DD format');
      }

      const { startInclusive, endExclusive } = getPatrolDateUtcBounds(selectedDate);
      query.andWhere('image.sentAt >= :startInclusive AND image.sentAt < :endExclusive', {
        startInclusive,
        endExclusive,
      });
    }

    let images = await query.getMany();
    images = images.filter((image) => isCountablePatrolImage(image));

    if (filters.date?.trim()) {
      images = filterPatrolImagesForPatrolDate(images, filters.date.trim());
    }

    if (filters.hour?.trim()) {
      const normalizedHour = Number(filters.hour.trim());

      if (!Number.isInteger(normalizedHour) || normalizedHour < 0 || normalizedHour > 23) {
        throw new BadRequestException('hour must be an integer between 0 and 23');
      }

      images = images.filter((image) => imagePatrolHourFromSentAt(image.sentAt) === normalizedHour);
    }

    images = dedupePatrolImagesForCount(images);
    logPatrolImagesForAggregation(this.logger, 'EVIDENCE_IMAGE_COUNT', images);

    return images.map((image) => this.normalizeDisplayStatus(image));
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<PatrolImage> {
    const image = await this.imageRepo.findOne({
      where: { id },
      relations: ['site', 'group'],
    });

    if (!image) {
      throw new NotFoundException(`Patrol image ${id} not found`);
    }

    if (user.role !== UserRole.ADMIN && image.site.companyId !== user.companyId) {
      throw new ForbiddenException('You do not have access to this company resource');
    }

    return this.normalizeDisplayStatus(image);
  }

  private parseRequiredDate(value: string, fieldName: 'sentAt' | 'receivedAt'): Date {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO-8601 date`);
    }

    return parsed;
  }

  private normalizeDisplayStatus(image: PatrolImage): PatrolImage {
    if (image.status === PatrolSlotStatus.DUPLICATE) {
      image.status = PatrolSlotStatus.RECEIVED_ON_TIME;
    }

    return image;
  }
}
