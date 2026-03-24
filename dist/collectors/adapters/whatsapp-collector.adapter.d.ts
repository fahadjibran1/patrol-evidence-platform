import { CollectorAdapter, NormalizedCollectorEvent } from '@/collectors/interfaces/collector-adapter.interface';
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
export declare class WhatsAppCollectorAdapter implements CollectorAdapter<WhatsAppIncomingEvent> {
    private readonly logger;
    ingestIncomingMedia(event: WhatsAppIncomingEvent): Promise<void>;
    normalizeIncomingEvent(event: WhatsAppIncomingEvent): Promise<NormalizedCollectorEvent>;
    downloadMedia(): Promise<Buffer>;
    mapSourceToSite(): Promise<string>;
}
