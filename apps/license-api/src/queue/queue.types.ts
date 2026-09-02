/**
 * Payload for an email-delivery job. `message`/`providerKind`/`auditContext` are kept as
 * `unknown`/loosely-typed here to avoid a compile-time dependency from the generic queue
 * infrastructure onto the notifications module — NotificationService owns the real shapes
 * and casts on the way in/out.
 */
export interface EmailJobPayload {
  notificationLogId: string;
  attempt?: number;
  message?: unknown;
  providerKind?: string;
  auditContext?: Record<string, unknown>;
}

export interface EmailJobResult {
  success: boolean;
  logId: string;
  status: string;
  errorMessage?: string;
  errorCode?: string;
  providerMessageId?: string;
  /** True when the job was handed to a real queue and delivery has not happened yet. */
  queued?: boolean;
}

export type QueueMode = 'redis' | 'inline';

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  mode: QueueMode;
}

/** A processor registered by a feature module (e.g. NotificationsModule) for a given queue. */
export type QueueProcessor<TPayload = unknown, TResult = unknown> = (payload: TPayload) => Promise<TResult>;
