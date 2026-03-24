import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { Site } from '@/sites/entities/site.entity';
import { PatrolImage } from './entities/patrol-image.entity';
import { StorageService } from '@/storage/storage.service';
import { ComplianceService } from '@/compliance/compliance.service';

export interface IngestPatrolImageEvent {
  collectorType: CollectorType;
  siteCode: string;
  timestamp: string;
  senderName?: string;
  originalFileName?: string;
  mimeType: string;
  fileSize: number;
  fileBuffer: Buffer;
}


export type ParsedIngestPatrolImageEvent = Omit<IngestPatrolImageEvent, 'timestamp'> & {
  timestamp: Date;
};

@Injectable()
export class PatrolImageIngestionService {
  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(PatrolImage)
    private readonly imageRepo: Repository<PatrolImage>,
    private readonly storageService: StorageService,
    private readonly complianceService: ComplianceService,
  ) {}

  async ingestPatrolImage(event: IngestPatrolImageEvent): Promise<PatrolImage> {
    const normalized = this.normalizeIncomingEvent(event);
    const site = await this.mapSourceToSite(normalized.siteCode);

    const stored = await this.storageService.savePatrolEvidence({
      siteCode: site.siteCode,
      timestamp: normalized.timestamp,
      buffer: normalized.fileBuffer,
      mimeType: normalized.mimeType,
    });

    const patrolDate = normalized.timestamp.toISOString().slice(0, 10);

    const image = await this.imageRepo.save(
      this.imageRepo.create({
        siteId: site.id,
        collectorType: normalized.collectorType,
        senderName: normalized.senderName ?? null,
        senderNumber: null,
        messageExternalId: null,
        sentAt: normalized.timestamp,
        receivedAt: new Date(),
        patrolDate,
        patrolHour: normalized.timestamp.getUTCHours(),
        originalFileName: normalized.originalFileName ?? null,
        storedFileName: stored.storedFileName,
        filePath: stored.filePath,
        fileSize: String(stored.fileSize),
        mimeType: stored.mimeType,
        status: PatrolSlotStatus.PENDING,
        notes: null,
      }),
    );

    const slotStatus = await this.complianceService.updateSlotStatusFromImage(image);
    image.status = slotStatus;
    return this.imageRepo.save(image);
  }

  private normalizeIncomingEvent(event: IngestPatrolImageEvent): ParsedIngestPatrolImageEvent {
    return {
      ...event,
      collectorType: event.collectorType ?? CollectorType.MANUAL,
      timestamp: new Date(event.timestamp),
      senderName: event.senderName?.trim() || 'manual',
    };
  }

  private async mapSourceToSite(siteCode: string): Promise<Site> {
    const site = await this.siteRepo.findOne({ where: { siteCode, active: true } });
    if (!site) {
      throw new NotFoundException(`Active site with code ${siteCode} not found`);
    }
    return site;
  }
}
