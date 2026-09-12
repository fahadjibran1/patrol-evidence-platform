import type { WhatsAppCollectorContact, WhatsAppCollectorGroup } from './whatsapp-helper.types';

export interface WhatsAppSourceChatMetadata {
  id?:
    | string
    | {
        _serialized?: unknown;
        $1?: unknown;
        user?: unknown;
        server?: unknown;
      }
    | null;
  isGroup?: unknown;
  formattedTitle?: unknown;
  name?: unknown;
  subject?: unknown;
  title?: unknown;
  isReadOnly?: unknown;
  unreadCount?: unknown;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeWhatsAppSourceId(value: WhatsAppSourceChatMetadata['id']): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (!value) {
    return '';
  }

  const serialized = readString(value._serialized) || readString(value.$1);
  if (serialized) {
    return serialized;
  }

  const user = readString(value.user);
  const server = readString(value.server);
  return user && server ? `${user}@${server}` : '';
}

function readDisplayName(chat: WhatsAppSourceChatMetadata, isGroup: boolean): string {
  for (const value of [chat.formattedTitle, chat.name, chat.subject, chat.title]) {
    const candidate = readString(value);
    if (candidate) {
      return candidate;
    }
  }

  return isGroup ? 'WhatsApp group' : 'WhatsApp contact';
}

function isStableSourceId(id: string): boolean {
  return /^[^@\s]+@[^@\s]+$/u.test(id);
}

export function projectWhatsAppSources(chats: WhatsAppSourceChatMetadata[]): {
  groups: WhatsAppCollectorGroup[];
  contacts: WhatsAppCollectorContact[];
} {
  const groups: WhatsAppCollectorGroup[] = [];
  const contacts: WhatsAppCollectorContact[] = [];
  const seen = new Set<string>();

  for (const chat of chats) {
    const id = normalizeWhatsAppSourceId(chat.id);
    if (!isStableSourceId(id) || seen.has(id)) {
      continue;
    }

    seen.add(id);
    const isGroup = chat.isGroup === true || /@g\.us$/iu.test(id);
    const name = readDisplayName(chat, isGroup);
    const unreadCount =
      typeof chat.unreadCount === 'number' && Number.isFinite(chat.unreadCount)
        ? Math.max(0, Math.trunc(chat.unreadCount))
        : 0;

    if (isGroup) {
      groups.push({
        id,
        name,
        isGroup: true,
        sourceType: 'group',
        isReadOnly: chat.isReadOnly === true,
        unreadCount,
      });
    } else {
      contacts.push({
        id,
        name,
        isGroup: false,
        sourceType: 'contact',
        unreadCount,
      });
    }
  }

  groups.sort((left, right) => left.name.localeCompare(right.name));
  contacts.sort((left, right) => left.name.localeCompare(right.name));
  return { groups, contacts };
}
