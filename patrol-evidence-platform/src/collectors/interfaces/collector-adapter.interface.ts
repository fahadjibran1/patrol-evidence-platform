export interface NormalizedCollectorEvent {
  collectorType: 'WHATSAPP' | 'GUARD_APP' | 'MANUAL';
  externalGroupId?: string;
  senderName?: string;
  senderNumber?: string;
  sentAt: Date;
  messageExternalId?: string;
  mediaUrl?: string;
  mimeType?: string;
  originalFileName?: string;
  rawBuffer?: Buffer;
}

export interface CollectorAdapter<TIncomingEvent = unknown> {
  ingestIncomingMedia(event: TIncomingEvent): Promise<void>;
  normalizeIncomingEvent(event: TIncomingEvent): Promise<NormalizedCollectorEvent>;
  downloadMedia(event: NormalizedCollectorEvent): Promise<Buffer>;
  mapSourceToSite(event: NormalizedCollectorEvent): Promise<string>;
}
