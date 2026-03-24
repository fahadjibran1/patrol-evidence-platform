import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface StoredFileResult {
  storedFileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
}

@Injectable()
export class StorageService {
  private readonly rootPath: string;

  constructor(configService: ConfigService) {
    this.rootPath = configService.getOrThrow<string>('storageRootPath');
  }

  async savePatrolEvidence(params: {
    siteCode: string;
    timestamp: Date;
    buffer: Buffer;
    mimeType: string;
  }): Promise<StoredFileResult> {
    const siteCode = this.sanitize(params.siteCode);
    const patrolDate = this.formatDate(params.timestamp);
    const timePart = this.formatTime(params.timestamp);

    const storedFileName = `${siteCode}_${patrolDate}_${timePart}.jpg`;
    const targetDir = path.join(this.rootPath, siteCode, patrolDate);
    const filePath = path.join(targetDir, storedFileName);

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(filePath, params.buffer);

    return {
      storedFileName,
      filePath,
      fileSize: params.buffer.length,
      mimeType: params.mimeType,
    };
  }

  private sanitize(value: string): string {
    return value
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');
  }

  private formatDate(value: Date): string {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatTime(value: Date): string {
    const hh = String(value.getUTCHours()).padStart(2, '0');
    const mm = String(value.getUTCMinutes()).padStart(2, '0');
    const ss = String(value.getUTCSeconds()).padStart(2, '0');
    return `${hh}-${mm}-${ss}`;
  }
}
