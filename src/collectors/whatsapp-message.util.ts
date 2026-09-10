import { PatrolSourceType } from '@/common/enums/patrol-source-type.enum';
import { inferPatrolSourceType } from '@/common/utils/patrol-source.util';

export { inferPatrolSourceType };

export interface WhatsAppGroupAddressMessage {
  from?: string;
  to?: string;
  fromMe?: boolean;
  id?: {
    remote?: string;
    _serialized?: string;
    $1?: string;
  };
}

export interface WhatsAppCanonicalMessageIdentity {
  id?: {
    _serialized?: unknown;
    $1?: unknown;
    id?: unknown;
    remote?: unknown;
    fromMe?: unknown;
    participant?: unknown;
  };
  _data?: {
    id?: {
      _serialized?: unknown;
      $1?: unknown;
      id?: unknown;
      remote?: unknown;
      fromMe?: unknown;
      participant?: unknown;
    };
  };
}

export interface WhatsAppMessageSource {
  externalId: string;
  sourceType: PatrolSourceType;
}

export function getMessageSourceId(message: WhatsAppGroupAddressMessage): WhatsAppMessageSource | null {
  const candidates = [message.from, message.to, message.id?.remote];

  for (const candidate of candidates) {
    if (candidate?.endsWith('@g.us')) {
      return { externalId: candidate, sourceType: PatrolSourceType.GROUP };
    }
  }

  if (message.id?.remote?.endsWith('@c.us')) {
    return { externalId: message.id.remote, sourceType: PatrolSourceType.CONTACT };
  }

  if (!message.fromMe && message.from?.endsWith('@c.us')) {
    return { externalId: message.from, sourceType: PatrolSourceType.CONTACT };
  }

  if (message.fromMe && message.to?.endsWith('@c.us')) {
    return { externalId: message.to, sourceType: PatrolSourceType.CONTACT };
  }

  const contactCandidates = candidates.filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.endsWith('@c.us'),
  );
  if (contactCandidates.length === 1) {
    return { externalId: contactCandidates[0], sourceType: PatrolSourceType.CONTACT };
  }

  if (contactCandidates.length >= 2) {
    const preferred = message.fromMe ? message.to : message.from;
    if (preferred?.endsWith('@c.us')) {
      return { externalId: preferred, sourceType: PatrolSourceType.CONTACT };
    }
  }

  return null;
}

/** @deprecated Use getMessageSourceId — kept for existing imports. */
export function getMessageGroupId(message: WhatsAppGroupAddressMessage): string | null {
  return getMessageSourceId(message)?.externalId ?? null;
}

/**
 * Shared fromMe gate used by the helper-process message pipeline.
 * When allowFromMe is false, self-sent messages are skipped before ingest.
 */
export function shouldSkipWhatsAppFromMe(fromMe: boolean, allowFromMe: boolean): boolean {
  return Boolean(fromMe) && !allowFromMe;
}

function nonEmptyIdentity(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Resolve the canonical WhatsApp message key across legacy and current live
 * WhatsApp Web model serialization. Current MsgKey.serialize() exposes its
 * canonical toString() value as `$1`; older builds expose `_serialized`.
 */
export function resolveCanonicalWhatsAppMessageId(
  message: WhatsAppCanonicalMessageIdentity,
): string | null {
  return (
    nonEmptyIdentity(message.id?._serialized) ??
    nonEmptyIdentity(message.id?.$1) ??
    nonEmptyIdentity(message._data?.id?._serialized) ??
    nonEmptyIdentity(message._data?.id?.$1)
  );
}

/**
 * Restore the legacy field expected internally by whatsapp-web.js 1.34.7.
 * Returns null rather than synthesizing an identity when no canonical field
 * is present or the received model is immutable.
 */
export function normalizeCanonicalWhatsAppMessageId(
  message: WhatsAppCanonicalMessageIdentity,
): string | null {
  const canonical = resolveCanonicalWhatsAppMessageId(message);
  if (!canonical || !message.id || typeof message.id !== 'object') {
    return null;
  }

  if (message.id._serialized === canonical) {
    return canonical;
  }

  try {
    message.id._serialized = canonical;
  } catch {
    return null;
  }

  return message.id._serialized === canonical ? canonical : null;
}

export interface CanonicalMessageOperationResult<T> {
  joined: boolean;
  result: T;
}

/** Serialize duplicate live callbacks while retaining the canonical ID as the persistence identity. */
export async function runCanonicalMessageOperationOnce<T>(
  inFlight: Map<string, Promise<T>>,
  canonicalId: string,
  operation: () => Promise<T>,
): Promise<CanonicalMessageOperationResult<T>> {
  const existing = inFlight.get(canonicalId);
  if (existing) {
    return { joined: true, result: await existing };
  }

  const pending = Promise.resolve().then(operation);
  inFlight.set(canonicalId, pending);
  try {
    return { joined: false, result: await pending };
  } finally {
    if (inFlight.get(canonicalId) === pending) {
      inFlight.delete(canonicalId);
    }
  }
}

/**
 * Resolve a usable display name for WhatsApp senders.
 * Generic placeholders such as "WhatsApp" fall back to the sender number.
 */
export function resolveWhatsAppSenderName(input: {
  senderNumber?: string;
  pushname?: string;
  name?: string;
  shortName?: string;
  fromMe: boolean;
}): string {
  const candidates = [input.pushname, input.name, input.shortName]
    .map((value) => value?.trim())
    .filter(
      (value): value is string =>
        typeof value === 'string' && value.length > 0 && value.toLowerCase() !== 'whatsapp',
    );

  if (candidates[0]) {
    return candidates[0];
  }

  if (input.fromMe) {
    return input.senderNumber ? `Linked account (${input.senderNumber})` : 'Linked account';
  }

  return input.senderNumber ?? 'Unknown sender';
}

export function isDetachedFrameError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('detached frame');
}

/**
 * Retry once when WhatsApp Web returns a detached-frame Puppeteer error.
 */
export async function withDetachedFrameRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isDetachedFrameError(error)) {
      throw error;
    }
    return operation();
  }
}
