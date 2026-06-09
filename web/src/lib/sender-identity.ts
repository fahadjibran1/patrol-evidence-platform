export function stripSourceFromSenderName(senderName?: string | null): string | null {
  const trimmed = senderName?.trim();
  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.lastIndexOf(' / ');
  if (separatorIndex > 0) {
    return trimmed.slice(0, separatorIndex).trim() || null;
  }

  return trimmed;
}

export function normalizePhoneKey(senderNumber?: string | null): string | null {
  const trimmed = senderNumber?.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }

  const digits = trimmed.replace(/\D/g, '');
  return digits ? `tel:${digits}` : null;
}

export function senderIdentityAliases(input: {
  senderExternalId?: string | null;
  senderNumber?: string | null;
}): string[] {
  const aliases = new Set<string>();
  const externalId = input.senderExternalId?.trim().toLowerCase();
  if (externalId) {
    aliases.add(`ext:${externalId}`);
    const jidDigits = externalId.match(/^(\d+)@/u)?.[1];
    if (jidDigits) {
      aliases.add(`tel:${jidDigits}`);
    }
  }

  const phoneKey = normalizePhoneKey(input.senderNumber);
  if (phoneKey) {
    if (phoneKey.startsWith('tel:')) {
      aliases.add(phoneKey);
    } else if (phoneKey.includes('@')) {
      aliases.add(`ext:${phoneKey}`);
      const jidDigits = phoneKey.match(/^(\d+)@/u)?.[1];
      if (jidDigits) {
        aliases.add(`tel:${jidDigits}`);
      }
    }
  }

  return [...aliases];
}

export function canonicalSenderKey(input: {
  senderExternalId?: string | null;
  senderNumber?: string | null;
  senderName?: string | null;
}): string | null {
  const externalId = input.senderExternalId?.trim().toLowerCase();
  if (externalId) {
    return `ext:${externalId}`;
  }

  return normalizePhoneKey(input.senderNumber);
}

export function senderIdentityKeysOverlap(
  left: { senderExternalId?: string | null; senderNumber?: string | null },
  right: { senderExternalId?: string | null; senderNumber?: string | null },
): boolean {
  const leftAliases = new Set(senderIdentityAliases(left));
  return senderIdentityAliases(right).some((alias) => leftAliases.has(alias));
}

export function buildSiteSenderMergeKey(
  siteId: string,
  input: { senderExternalId?: string | null; senderNumber?: string | null },
): string | null {
  const aliases = senderIdentityAliases(input);
  if (aliases.length === 0) {
    return null;
  }

  const preferred =
    aliases.find((alias) => alias.startsWith('ext:')) ??
    aliases.find((alias) => alias.startsWith('tel:')) ??
    aliases[0];

  return `${siteId}::${preferred}`;
}

export function buildSenderPersonKey(senderKey: string): string {
  return `sender:${senderKey}`;
}
