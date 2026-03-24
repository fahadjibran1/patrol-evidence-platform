import { ConfigService } from '@nestjs/config';
export interface StoredFileResult {
    storedFileName: string;
    filePath: string;
    fileSize: number;
    mimeType: string;
}
export declare class StorageService {
    private readonly rootPath;
    constructor(configService: ConfigService);
    savePatrolEvidence(params: {
        siteCode: string;
        timestamp: Date;
        buffer: Buffer;
        mimeType: string;
    }): Promise<StoredFileResult>;
    private sanitize;
    private formatDate;
    private formatTime;
}
