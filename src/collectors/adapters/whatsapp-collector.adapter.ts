import { Injectable, Logger } from '@nestjs/common';
import {
  CollectorAdapter,
  NormalizedCollectorEvent,
} from '@/collectors/interfaces/collector-adapter.interface';

export interface WhatsAppIncomingEvent {
  groupId?: string;
  senderName?: string;
  senderNumber?: string;
  sentAt: string;
  messageId?: string;
  mediaUrl?: string;
  mimeType?: string;
  fileName?: string;
}

@Injectable()
export class WhatsAppCollectorAdapter implements CollectorAdapter<WhatsAppIncomingEvent> {
  private readonly logger = new Logger(WhatsAppCollectorAdapter.name);

  async ingestIncomingMedia(event: WhatsAppIncomingEvent): Promise<void> {
    const normalized = await this.normalizeIncomingEvent(event);
    this.logger.log(`Received WhatsApp media event ${normalized.messageExternalId ?? 'unknown'}`);
  }

  async normalizeIncomingEvent(event: WhatsAppIncomingEvent): Promise<NormalizedCollectorEvent> {
    return {
      collectorType: 'WHATSAPP',
      externalGroupId: event.groupId,
      senderName: event.senderName,
      senderNumber: event.senderNumber,
      sentAt: new Date(event.sentAt),
      messageExternalId: event.messageId,
      mediaUrl: event.mediaUrl,
      mimeType: event.mimeType,
      originalFileName: event.fileName,
    };
  }

  async downloadMedia(): Promise<Buffer> {
    throw new Error('WhatsApp media download integration is intentionally deferred to Phase 3 adapter boundary.');
  }

  async mapSourceToSite(): Promise<string> {
    throw new Error('WhatsApp site mapping integration is intentionally deferred to Phase 3 adapter boundary.');
  }
}
