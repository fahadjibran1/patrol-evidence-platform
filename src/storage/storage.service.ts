import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
const sharp = require('sharp') as typeof import('sharp').default;
import { getPatrolTimeParts, patrolTimeZone } from '@/common/utils/patrol-time.util';

const STORAGE_HEADROOM_BYTES = 64 * 1024 * 1024;

export function normalizeStorageWriteError(error: unknown): Error {
  if ((error as NodeJS.ErrnoException)?.code === 'ENOSPC') {
    const storageError = new Error('Storage full or insufficient space. Free disk space before PatrolSafe can save more evidence.');
    (storageError as NodeJS.ErrnoException).code = 'PATROLSAFE_INSUFFICIENT_SPACE';
    return storageError;
  }
  return error instanceof Error ? error : new Error(String(error));
}

export interface StoredFileResult {
  storedFileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  contentSha256: string;
  tempPath?: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly rootPath: string;
  private readonly securityCompanyName: string;
  private readonly businessTimeZone: string;

  constructor(configService: ConfigService) {
    this.rootPath = configService.getOrThrow<string>('storageRootPath');
    this.securityCompanyName = configService.get<string>('securityCompanyName')?.trim() || 'Tech Guards Security';
    this.businessTimeZone = configService.get<string>('businessTimeZone')?.trim() || patrolTimeZone();
    this.logger.log(`patrol-image-storage-path path=${this.rootPath}`);
  }

  async savePatrolEvidence(params: {
    siteCode: string;
    siteName?: string;
    senderName?: string;
    timestamp: Date;
    buffer: Buffer;
    mimeType: string;
    uniqueSuffix?: string;
  }): Promise<StoredFileResult> {
    const staged = await this.stagePatrolEvidence(params);
    await this.finalizePatrolEvidence(staged);
    const { tempPath: _tempPath, ...result } = staged;
    return result;
  }

  async stagePatrolEvidence(params: {
    siteCode: string; siteName?: string; senderName?: string; timestamp: Date;
    buffer: Buffer; mimeType: string; uniqueSuffix?: string;
  }): Promise<StoredFileResult & { tempPath: string }> {
    const siteCode = this.sanitize(params.siteCode);
    const patrolTime = getPatrolTimeParts(params.timestamp, this.businessTimeZone);
    const patrolDate = patrolTime.date;
    const patrolHour = patrolTime.hourFolder;
    const timePart = patrolTime.timePart;
    const extension = this.resolveExtension(params.mimeType);
    if (!['image/jpeg', 'image/png'].includes(params.mimeType.toLowerCase())) {
      throw new Error(`Unsupported evidence MIME type: ${params.mimeType}`);
    }
    if (params.buffer.length > 25 * 1024 * 1024) {
      throw new Error('Evidence image exceeds the 25MB limit');
    }
    const storedFileName = `${siteCode}_${patrolDate}_${timePart}_${randomUUID()}.${extension}`;
    const targetDir = path.join(this.rootPath, siteCode, patrolDate, patrolHour);
    const filePath = path.join(targetDir, storedFileName);

    this.assertContained(targetDir);
    this.assertContained(filePath);

    try {
      await fs.mkdir(targetDir, { recursive: true });
    } catch (error) {
      throw normalizeStorageWriteError(error);
    }
    await this.assertStorageHeadroom(params.buffer.length);

    const storedBuffer = await this.stampEvidenceImage(params);
    await this.assertStorageHeadroom(storedBuffer.length);
    const contentSha256 = createHash('sha256').update(storedBuffer).digest('hex');
    const tempPath = path.join(targetDir, `.staging-${randomUUID()}.tmp`);
    this.assertContained(tempPath);
    try {
      const handle = await fs.open(tempPath, 'wx');
      try { await handle.writeFile(storedBuffer); } finally { await handle.close(); }
      try { await fs.access(filePath); throw new Error('Evidence destination already exists'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw normalizeStorageWriteError(error);
    }

    return {
      storedFileName,
      filePath,
      fileSize: storedBuffer.length,
      mimeType: params.mimeType,
      contentSha256,
      tempPath,
    };
  }

  async finalizePatrolEvidence(staged: StoredFileResult & { tempPath: string }): Promise<void> {
    this.assertContained(staged.tempPath);
    this.assertContained(staged.filePath);
    try { await fs.access(staged.filePath); throw new Error('Evidence destination already exists'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await fs.rename(staged.tempPath, staged.filePath);
    } catch (error) {
      throw normalizeStorageWriteError(error);
    }
  }

  async removeOwnedFile(filePath: string): Promise<void> {
    if (!this.isContained(filePath)) return;
    await fs.unlink(filePath).catch(() => undefined);
  }

  private isContained(candidate: string): boolean {
    const root = path.resolve(this.rootPath);
    const resolved = path.resolve(candidate);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
  }

  private assertContained(candidate: string): void {
    if (!this.isContained(candidate)) throw new Error('Evidence path escapes configured storage root');
  }

  private async assertStorageHeadroom(payloadBytes: number): Promise<void> {
    try {
      const stats = await fs.statfs(this.rootPath);
      const availableBytes = Number(stats.bavail) * Number(stats.bsize);
      if (availableBytes < payloadBytes + STORAGE_HEADROOM_BYTES) {
        const error = new Error('Insufficient storage capacity');
        (error as NodeJS.ErrnoException).code = 'ENOSPC';
        throw error;
      }
    } catch (error) {
      throw normalizeStorageWriteError(error);
    }
  }

  private async stampEvidenceImage(params: {
    siteCode: string;
    siteName?: string;
    senderName?: string;
    timestamp: Date;
    buffer: Buffer;
    mimeType: string;
  }): Promise<Buffer> {
    const image = sharp(params.buffer).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? 1280;
    const height = metadata.height ?? 720;
    const overlayHeight = Math.min(height, Math.max(110, Math.round(height * 0.16)));
    const paddingX = Math.max(18, Math.round(width * 0.02));
    const paddingY = Math.max(14, Math.round(overlayHeight * 0.14));
    const titleSize = Math.max(22, Math.round(width * 0.025));
    const bodySize = Math.max(18, Math.round(width * 0.018));
    const lineGap = Math.max(10, Math.round(bodySize * 0.45));
    const siteName = params.siteName?.trim() || 'Unknown site';
    const senderName = params.senderName?.trim() || 'Unknown sender';
    const formattedDateTime = this.formatOverlayDateTime(params.timestamp);

    const overlaySvg = this.buildOverlaySvg({
      width,
      height: overlayHeight,
      paddingX,
      paddingY,
      titleSize,
      bodySize,
      lineGap,
      companyName: this.securityCompanyName,
      siteCode: params.siteCode,
      siteName,
      dateTime: formattedDateTime,
      senderName,
    });

    return image
      .composite([
        {
          input: Buffer.from(overlaySvg),
          top: Math.max(0, height - overlayHeight),
          left: 0,
        },
      ])
      .toBuffer();
  }

  private buildOverlaySvg(params: {
    width: number;
    height: number;
    paddingX: number;
    paddingY: number;
    titleSize: number;
    bodySize: number;
    lineGap: number;
    companyName: string;
    siteCode: string;
    siteName: string;
    dateTime: string;
    senderName: string;
  }): string {
    const lineOneY = params.paddingY + params.titleSize;
    const lineTwoY = lineOneY + params.lineGap + params.bodySize;
    const lineThreeY = lineTwoY + params.lineGap + params.bodySize;
    const lineFourY = lineThreeY + params.lineGap + params.bodySize;

    return `
      <svg width="${params.width}" height="${params.height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${params.width}" height="${params.height}" fill="rgba(0,0,0,0.55)" />
        <text x="${params.paddingX}" y="${lineOneY}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${params.titleSize}" font-weight="700">${this.escapeXml(params.companyName)}</text>
        <text x="${params.paddingX}" y="${lineTwoY}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${params.bodySize}">Site: ${this.escapeXml(params.siteCode)} - ${this.escapeXml(params.siteName)}</text>
        <text x="${params.paddingX}" y="${lineThreeY}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${params.bodySize}">Date/Time: ${this.escapeXml(params.dateTime)}</text>
        <text x="${params.paddingX}" y="${lineFourY}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${params.bodySize}">Sender: ${this.escapeXml(params.senderName)}</text>
      </svg>
    `.trim();
  }

  private formatOverlayDateTime(timestamp: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: this.businessTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(timestamp);
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private sanitize(value: string): string {
    return value
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_');
  }

  private resolveExtension(mimeType: string): string {
    if (mimeType.toLowerCase() === 'image/png') {
      return 'png';
    }

    if (mimeType.toLowerCase() === 'image/jpeg') return 'jpg';
    throw new Error(`Unsupported evidence MIME type: ${mimeType}`);
  }
}
