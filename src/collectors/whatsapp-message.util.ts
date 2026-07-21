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
