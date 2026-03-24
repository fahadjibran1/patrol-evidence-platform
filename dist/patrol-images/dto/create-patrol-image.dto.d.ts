import { CollectorType } from '@/common/enums/collector-type.enum';
export declare class CreatePatrolImageDto {
    siteId: string;
    groupId?: string;
    collectorType: CollectorType;
    senderName?: string;
    senderNumber?: string;
    messageExternalId?: string;
    sentAt: string;
    receivedAt: string;
    patrolDate: string;
    patrolHour: number;
    originalFileName?: string;
    storedFileName: string;
    filePath: string;
    fileSize: string;
    mimeType: string;
    notes?: string;
}
