import { Repository } from 'typeorm';
import { CollectorType } from '@/common/enums/collector-type.enum';
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
export declare class PatrolImageIngestionService {
    private readonly siteRepo;
    private readonly imageRepo;
    private readonly storageService;
    private readonly complianceService;
    constructor(siteRepo: Repository<Site>, imageRepo: Repository<PatrolImage>, storageService: StorageService, complianceService: ComplianceService);
    ingestPatrolImage(event: IngestPatrolImageEvent): Promise<PatrolImage>;
    private normalizeIncomingEvent;
    private mapSourceToSite;
}
