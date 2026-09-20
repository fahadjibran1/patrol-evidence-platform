import { createHash } from 'crypto';

const UNKNOWN_SENDER = 'Unknown Sender';
const MAX_BASE_CODE_POINTS = 48;
const COLLISION_SUFFIX_LENGTH = 12;

/** A human-readable folder label, never an evidence or sender identity. */
export function senderFolderName(displayName?: string): string {
  const label = displayName?.normalize('NFC').trim() ?? '';
  // WhatsApp can substitute a phone number or JID when a contact has no name.
  // Keep those identifiers in database metadata, not in the browsable archive.
  if (!label || /^unknown sender$/iu.test(label) || /^whatsapp$/iu.test(label) ||
      /^linked account(?:\s*\(|$)/iu.test(label) ||
      /(?:^|[^\p{L}\p{N}])\+?\d[\d\s().-]{5,}\d(?:$|[^\p{L}\p{N}])/u.test(label) ||
      label.includes('@')) {
    return UNKNOWN_SENDER;
  }

  const cleaned = label
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, '_')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/[ .]+$/u, '')
    .trim();
  if (!cleaned || /^\.+$/u.test(cleaned)) return UNKNOWN_SENDER;

  const reserved = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu.test(cleaned);
  const safe = Array.from(reserved ? `_${cleaned}` : cleaned)
    .slice(0, MAX_BASE_CODE_POINTS)
    .join('')
    .replace(/[ .]+$/u, '');
  if (!safe) return UNKNOWN_SENDER;

  // A suffix derived only from the already-visible display label separates
  // labels that sanitise/truncate to the same Windows path. Raw WhatsApp IDs
  // and phone numbers are never used in path components.
  if (safe === label) return safe;
  const suffix = createHash('sha256').update(label, 'utf8').digest('hex').slice(0, COLLISION_SUFFIX_LENGTH);
  return `${safe}~${suffix}`;
}
