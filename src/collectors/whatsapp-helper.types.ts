export type CollectorState =
  | 'disabled'
  | 'idle'
  | 'starting'
  | 'browser-launching'
  | 'whatsapp-loading'
  | 'waiting-for-qr'
  | 'qr-ready'
  | 'authenticated'
  | 'waiting-for-client-info'
  | 'ready'
  | 'disconnected'
  | 'failed';

export interface WhatsAppCollectorGroup {
  id: string;
  name: string;
  isGroup: true;
  sourceType: 'group';
  isReadOnly: boolean;
  unreadCount: number;
}

export interface WhatsAppCollectorContact {
  id: string;
  name: string;
  isGroup: false;
  sourceType: 'contact';
  unreadCount: number;
}

export interface WhatsAppHelperGroupMapping {
  externalGroupId: string;
  sourceType: 'group' | 'contact';
  mappedGroupId: string;
  groupName: string;
  siteCode: string;
}

export interface WhatsAppHelperRuntimeConfig {
  allowFromMe: boolean;
  pilotGroupName: string | null;
  pilotSiteCode: string | null;
  mappedGroups: WhatsAppHelperGroupMapping[];
}

export interface WhatsAppHelperIngestPayload {
  siteCode: string;
  groupId?: string;
  sourceExternalId?: string;
  senderName?: string;
  senderNumber?: string;
  senderExternalId?: string;
  messageExternalId?: string;
  originalFileName?: string;
  mimeType: string;
  fileSize: number;
  fileBase64: string;
  timestamp: string;
}

export interface WhatsAppHelperStatusSnapshot {
  enabled: boolean;
  connected: boolean;
  ready: boolean;
  state: CollectorState;
  info: string;
  sessionPath: string;
  qrCode: string | null;
  lastQrAt: string | null;
  lastMessageAt: string | null;
  lastEventAt: string | null;
  lastReadyAt: string | null;
  lastDisconnectAt: string | null;
  lastBackfillAt: string | null;
  connectedAccount: string | null;
  backfillRunning: boolean;
  backfillMessagesScanned: number;
  backfillImagesImported: number;
  backfillDuplicatesSkipped: number;
  allowFromMe: boolean;
  startupStage: string | null;
  startupStartedAt: string | null;
  lastError: string | null;
  collectorLogPath: string;
  latestQrPath: string;
  qrPayloadLength: number | null;
  qrPersistedAt: string | null;
  qrDeliveredAt: string | null;
  browserExecutablePath: string | null;
  browserExecutableSource: string | null;
  browserCandidatesTried: string[];
  sessionPathExists: boolean;
  sessionPathWritable: boolean;
  sessionCorruptionSuspected: boolean;
  sessionCorruptionMessage: string | null;
  groups: WhatsAppCollectorGroup[];
  contacts: WhatsAppCollectorContact[];
}

export type WhatsAppHelperEvent = {
  type: 'status';
  payload: WhatsAppHelperStatusSnapshot;
};

export type WhatsAppHelperCommand =
  | {
      type: 'stop';
    }
  | {
      type: 'manual-backfill';
      hours: number;
    }
  | {
      type: 'send-test-image';
      groupId?: string;
    }
  | {
      type: 'probe-auth-ready-lifecycle';
    }
  | {
      type: 'refresh-discovered-chats';
    };

export const WHATSAPP_HELPER_EVENT_PREFIX = 'PATROL_COLLECTOR_EVENT ';
