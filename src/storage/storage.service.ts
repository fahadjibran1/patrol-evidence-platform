import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import sharp = require('sharp');
import { getPatrolTimeParts, patrolTimeZone } from '@/common/utils/patrol-time.util';

export interface StoredFileResult {
  storedFileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
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
    const siteCode = this.sanitize(params.siteCode);
    const patrolTime = getPatrolTimeParts(params.timestamp, this.businessTimeZone);
    const patrolDate = patrolTime.date;
    const patrolHour = patrolTime.hourFolder;
    const timePart = patrolTime.timePart;
    const suffix = params.uniqueSuffix ? `_${this.sanitize(params.uniqueSuffix)}` : '';

    const extension = this.resolveExtension(params.mimeType);
    const storedFileName = `${siteCode}_${patrolDate}_${timePart}${suffix}.${extension}`;
    const targetDir = path.join(this.rootPath, siteCode, patrolDate, patrolHour);
    const filePath = path.join(targetDir, storedFileName);

    await fs.mkdir(targetDir, { recursive: true });

    const storedBuffer = await this.stampEvidenceImage(params).catch(async (error) => {
      this.logger.error(
        `Failed to stamp evidence image for site ${params.siteCode}. Falling back to original image save.`,
        error instanceof Error ? error.stack : undefined,
      );
      return params.buffer;
    });

    await fs.writeFile(filePath, storedBuffer);

    return {
      storedFileName,
      filePath,
      fileSize: storedBuffer.length,
      mimeType: params.mimeType,
    };
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

    return 'jpg';
  }
}
