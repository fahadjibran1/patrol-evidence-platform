import { NotificationProviderKind, NotificationType } from '@prisma/client';

export interface NotificationAttachment {
  filename: string;
  content: string | Buffer;
  contentType: string;
}

export interface NotificationMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  notificationType: NotificationType;
  attachments?: NotificationAttachment[];
}

export interface NotificationSendResult {
  success: boolean;
  providerMessageId?: string;
  errorMessage?: string;
  errorCode?: string;
}

export interface NotificationProvider {
  readonly kind: NotificationProviderKind;
  supports(notificationType: NotificationType): boolean;
  send(message: NotificationMessage): Promise<NotificationSendResult>;
}

export const NOTIFICATION_PROVIDERS = Symbol('NOTIFICATION_PROVIDERS');
