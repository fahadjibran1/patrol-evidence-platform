export interface CertificationChatMetadata {
  id?: { _serialized?: unknown } | string | null;
  isGroup?: unknown;
  formattedTitle?: unknown;
  name?: unknown;
  subject?: unknown;
  title?: unknown;
}

export interface CertificationGroupMatch {
  name: string;
  id: string;
}

function readId(chat: CertificationChatMetadata): string {
  if (typeof chat.id === 'string') return chat.id.trim();
  return typeof chat.id?._serialized === 'string' ? chat.id._serialized.trim() : '';
}

function readName(chat: CertificationChatMetadata): string {
  for (const value of [chat.formattedTitle, chat.name, chat.subject, chat.title]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function projectCertificationGroupMatches(
  chats: CertificationChatMetadata[],
  requestedDisplayName: string,
): CertificationGroupMatch[] {
  const requested = requestedDisplayName.trim();
  if (!requested) return [];
  const seen = new Set<string>();
  return chats
    .map((chat) => ({ name: readName(chat), id: readId(chat), isGroup: chat.isGroup === true }))
    .filter((chat) => chat.isGroup && chat.name === requested && /@g\.us$/i.test(chat.id))
    .filter((chat) => chat.id && !seen.has(chat.id) && seen.add(chat.id))
    .map(({ name, id }) => ({ name, id }));
}
