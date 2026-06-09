import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DeepPartial, Repository } from 'typeorm';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { PatrolImage } from './entities/patrol-image.entity';
import { StorageService } from '@/storage/storage.service';
import { ComplianceService } from '@/compliance/compliance.service';
import { SitesService } from '@/sites/sites.service';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { UserRole } from '@/common/enums/user-role.enum';
import { getPatrolTimeParts } from '@/common/utils/patrol-time.util';

export interface IngestPatrolImageEvent {
  collectorType: CollectorType;
  siteCode: string;
  timestamp: string;
  groupId?: string;
  senderName?: string;
  senderNumber?: string;
  senderExternalId?: string;
  messageExternalId?: string;
  originalFileName?: string;
  mimeType: string;
  fileSize: number;
  fileBuffer: Buffer;
}

type ParsedIngestPatrolImageEvent = Omit<IngestPatrolImageEvent, 'timestamp'> & {
  timestamp: Date;
};

const SYSTEM_USER: AuthenticatedUser = {
  sub: 'system',
  email: 'system@local',
  role: UserRole.ADMIN,
  companyId: null,
};

@Injectable()
export class PatrolImageIngestionService {
  private readonly logger = new Logger(PatrolImageIngestionService.name);

  constructor(
    private readonly sitesService: SitesService,
    @InjectRepository(PatrolImage)
    private readonly imageRepo: Repository<PatrolImage>,
    private readonly storageService: StorageService,
    private readonly complianceService: ComplianceService,
  ) {}

  async ingestPatrolImage(event: IngestPatrolImageEvent, user?: AuthenticatedUser): Promise<PatrolImage> {
    const normalized = this.normalizeIncomingEvent(event);
    this.logger.log(
      `pipeline:image-ingest-received siteCode=${normalized.siteCode} message=${normalized.messageExternalId ?? 'none'} bytes=${normalized.fileBuffer.length}`,
    );
    const existing = await this.findExistingByExternalMessageId(normalized.messageExternalId);
    if (existing) {
      this.logger.log(`pipeline:image-ingest-duplicate imageId=${existing.id} message=${normalized.messageExternalId}`);
      return existing;
    }

    let site;
    try {
      site = await this.sitesService.findActiveByCode(normalized.siteCode, user ?? SYSTEM_USER);
    } catch (error) {
      this.logger.error(
        `pipeline:site-not-matched siteCode=${normalized.siteCode} error=${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    this.logger.log(`pipeline:site-matched siteId=${site.id} siteCode=${site.siteCode}`);

    let stored;
    try {
      stored = await this.storageService.savePatrolEvidence({
        siteCode: site.siteCode,
        siteName: site.siteName,
        senderName: normalized.senderName ?? undefined,
        timestamp: normalized.timestamp,
        buffer: normalized.fileBuffer,
        mimeType: normalized.mimeType,
        uniqueSuffix: this.buildStorageSuffix(normalized.messageExternalId),
      });
    } catch (error) {
      this.logger.error(
        `pipeline:storage-failure siteCode=${site.siteCode} error=${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    this.logger.log(`APP_IMAGE_CAPTURED sender=${normalized.senderNumber ?? 'unknown'} site=${site.siteCode} file=${stored.filePath}`);
    this.logger.log(`pipeline:storage-path path=${stored.filePath} bytes=${stored.fileSize}`);

    const patrolTime = getPatrolTimeParts(normalized.timestamp);

    const imageData: DeepPartial<PatrolImage> = {
      siteId: site.id,
      groupId: normalized.groupId ?? undefined,
      collectorType: normalized.collectorType,
      senderName: normalized.senderName ?? undefined,
      senderNumber: normalized.senderNumber ?? undefined,
      senderExternalId: normalized.senderExternalId ?? undefined,
      messageExternalId: normalized.messageExternalId ?? undefined,
      sentAt: normalized.timestamp,
      receivedAt: new Date(),
      patrolDate: patrolTime.date,
      patrolHour: patrolTime.hour,
      originalFileName: normalized.originalFileName ?? undefined,
      storedFileName: stored.storedFileName,
      filePath: stored.filePath,
      fileSize: String(stored.fileSize),
      mimeType: stored.mimeType,
      status: PatrolSlotStatus.PENDING,
      notes: undefined,
    };

    let image: PatrolImage;
    try {
      const imageEntity = this.imageRepo.create(imageData);
      image = await this.imageRepo.save(imageEntity);
      this.logger.log(`pipeline:db-save-success imageId=${image.id} siteId=${image.siteId}`);
    } catch (error) {
      this.logger.error(
        `pipeline:db-save-failure siteCode=${site.siteCode} path=${stored.filePath} error=${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }

    const slotStatus = await this.complianceService.updateSlotStatusFromImage(image);
    image.status = slotStatus;
    this.logger.log(`pipeline:guard-safe-updated imageId=${image.id} status=${slotStatus}`);

    return this.imageRepo.save(image);
  }

  async findExistingByExternalMessageId(messageExternalId?: string): Promise<PatrolImage | null> {
    const normalizedMessageExternalId = messageExternalId?.trim();
    if (!normalizedMessageExternalId) {
      return null;
    }

    return this.imageRepo.findOne({
      where: { messageExternalId: normalizedMessageExternalId },
      relations: ['site', 'group'],
    });
  }

  private normalizeIncomingEvent(event: IngestPatrolImageEvent): ParsedIngestPatrolImageEvent {
    const timestamp = new Date(event.timestamp);
    if (Number.isNaN(timestamp.getTime())) {
      throw new BadRequestException('timestamp must be a valid ISO-8601 date');
    }

    return {
      ...event,
      collectorType: event.collectorType ?? CollectorType.MANUAL,
      siteCode: event.siteCode.trim().toUpperCase(),
      groupId: event.groupId,
      timestamp,
      senderName: event.senderName?.trim() || 'manual',
      senderNumber: event.senderNumber?.trim() || undefined,
      senderExternalId: event.senderExternalId?.trim() || undefined,
      messageExternalId: event.messageExternalId?.trim() || undefined,
    };
  }

  private buildStorageSuffix(messageExternalId?: string): string {
    const normalized = messageExternalId?.trim();
    if (!normalized) {
      return randomUUID().slice(0, 8);
    }

    return normalized.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-24);
  }
}
