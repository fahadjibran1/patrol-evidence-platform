import { Site } from '@/sites/entities/site.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
export declare class PatrolImage {
    id: string;
    siteId: string;
    site: Site;
    groupId: string | null;
    group: PatrolGroup | null;
    collectorType: CollectorType;
    senderName: string | null;
    senderNumber: string | null;
    messageExternalId: string | null;
    sentAt: Date;
    receivedAt: Date;
    patrolDate: string;
    patrolHour: number;
    originalFileName: string | null;
    storedFileName: string;
    filePath: string;
    fileSize: string;
    mimeType: string;
    status: PatrolSlotStatus;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
}
