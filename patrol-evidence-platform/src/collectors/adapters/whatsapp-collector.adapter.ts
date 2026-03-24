import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CollectorAdapter,
  NormalizedCollectorEvent,
} from '@/collectors/interfaces/collector-adapter.interface';
import { PatrolImageIngestionService } from '@/patrol-images/patrol-image-ingestion.service';
import { CollectorType } from '@/common/enums/collector-type.enum';

export interface WhatsAppIncomingEvent {
  groupName: string;
  senderName?: string;
  senderNumber?: string;
  timestamp: number;
  messageId?: string;
  media?: {
    mimeType: string;
    fileName?: string;
    data: Buffer;
  };
}

@Injectable()
export class WhatsAppCollectorAdapter
  implements CollectorAdapter<WhatsAppIncomingEvent>, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WhatsAppCollectorAdapter.name);
  private connected = false;
  private readonly enabled: boolean;
  private readonly pilotGroupName: string;
  private readonly pilotSiteCode: string;
  private readonly sessionPath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly ingestionService: PatrolImageIngestionService,
  ) {
    this.enabled = (this.configService.get<string>('WHATSAPP_ENABLED') ?? 'false') === 'true';
    this.pilotGroupName = this.configService.get<string>('WHATSAPP_PILOT_GROUP_NAME') ?? '';
    this.pilotSiteCode = this.configService.get<string>('WHATSAPP_PILOT_SITE_CODE') ?? '';
    this.sessionPath = this.configService.get<string>('WHATSAPP_SESSION_PATH') ?? './.whatsapp-session';
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('WhatsApp pilot is disabled.');
      return;
    }

    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) {
      await this.disconnect();
    }
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.logger.log(`WhatsApp pilot connected. Session path: ${this.sessionPath}`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.logger.warn('WhatsApp pilot disconnected.');
  }

  async ingestIncomingMedia(event: WhatsAppIncomingEvent): Promise<void> {
    if (!this.enabled) {
      this.logger.debug('WhatsApp image ignored because pilot is disabled.');
      return;
    }

    const normalized = await this.normalizeIncomingEvent(event);
    if (!normalized.mediaUrl) {
      this.logger.debug('WhatsApp message ignored: non-media payload.');
      return;
    }

    const siteCode = await this.mapSourceToSite(normalized);
    const mediaBuffer = await this.downloadMedia(normalized);

    this.logger.log(`WhatsApp image received for group ${event.groupName}.`);

    try {
      await this.ingestionService.ingestPatrolImage({
        collectorType: CollectorType.WHATSAPP,
        siteCode,
        timestamp: normalized.sentAt.toISOString(),
        senderName: normalized.senderName,
        originalFileName: normalized.originalFileName,
        mimeType: normalized.mimeType ?? 'image/jpeg',
        fileSize: mediaBuffer.length,
        fileBuffer: mediaBuffer,
      });
      this.logger.log('WhatsApp ingestion success.');
    } catch (error) {
      this.logger.error(`WhatsApp ingestion failure: ${(error as Error).message}`);
      throw error;
    }
  }

  async normalizeIncomingEvent(event: WhatsAppIncomingEvent): Promise<NormalizedCollectorEvent> {
    if (!event.media || !event.media.mimeType.startsWith('image/')) {
      this.logger.debug('WhatsApp message ignored: media missing or non-image.');
      return {
        collectorType: 'WHATSAPP',
        externalGroupId: event.groupName,
        senderName: event.senderName,
        senderNumber: event.senderNumber,
        sentAt: new Date(event.timestamp * 1000),
      };
    }

    return {
      collectorType: 'WHATSAPP',
      externalGroupId: event.groupName,
      senderName: event.senderName,
      senderNumber: event.senderNumber,
      sentAt: new Date(event.timestamp * 1000),
      messageExternalId: event.messageId,
      mediaUrl: `inline-buffer://${event.messageId ?? Date.now()}`,
      mimeType: event.media.mimeType,
      originalFileName: event.media.fileName,
      rawBuffer: event.media.data,
    };
  }

  async downloadMedia(event: NormalizedCollectorEvent): Promise<Buffer> {
    return event.rawBuffer ?? Buffer.alloc(0);
  }

  async mapSourceToSite(event: NormalizedCollectorEvent): Promise<string> {
    if (!this.pilotGroupName || !this.pilotSiteCode) {
      throw new Error('WhatsApp pilot group/site mapping is not configured.');
    }

    if (event.externalGroupId !== this.pilotGroupName) {
      this.logger.debug(`WhatsApp image ignored: group ${event.externalGroupId} is not pilot group.`);
      throw new Error('Incoming group is not configured for pilot site mapping.');
    }

    return this.pilotSiteCode;
  }

  async simulateIncomingImage(event: WhatsAppIncomingEvent): Promise<void> {
    await this.ingestIncomingMedia(event);
  }
}
