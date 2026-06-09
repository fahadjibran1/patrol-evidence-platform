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
