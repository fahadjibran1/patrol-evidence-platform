import { senderFolderName } from './sender-folder.util';

describe('senderFolderName', () => {
  it('keeps ordinary and Unicode display names readable', () => {
    expect(senderFolderName('Sidra')).toBe('Sidra');
    expect(senderFolderName('Élodie 東京')).toBe('Élodie 東京');
  });

  it('uses Unknown Sender when a name is absent or is an identifier substitute', () => {
    for (const value of [undefined, '', '  ', 'Unknown sender', 'WhatsApp', '+44 7700 900123', '447700900123',
      '447700900123@c.us', 'Linked account (447700900123)', 'Sidra +44 7700 900123', 'sidra@example.invalid']) {
      expect(senderFolderName(value)).toBe('Unknown Sender');
    }
  });

  it('sanitises Windows-invalid characters and separates colliding labels deterministically', () => {
    const slash = senderFolderName('Patrol/A');
    const colon = senderFolderName('Patrol:A');
    expect(slash).toMatch(/^Patrol_A~[0-9a-f]{12}$/);
    expect(colon).toMatch(/^Patrol_A~[0-9a-f]{12}$/);
    expect(slash).not.toBe(colon);
    expect(senderFolderName('Patrol/A')).toBe(slash);
    expect(senderFolderName('A<>:"/\\|?*B')).not.toMatch(/[<>:"/\\|?*]/u);
  });

  it('handles reserved names, trailing dots/spaces, empty sanitised names and long labels', () => {
    for (const value of ['CON', 'NUL.txt', 'COM1', 'LPT³']) {
      expect(senderFolderName(value)).toMatch(/^_/u);
    }
    expect(senderFolderName('Sidra. ')).toMatch(/^Sidra~[0-9a-f]{12}$/u);
    expect(senderFolderName('...')).toBe('Unknown Sender');
    expect(Array.from(senderFolderName('A'.repeat(140))).length).toBeLessThanOrEqual(61);
    expect(senderFolderName('A'.repeat(139) + 'B')).not.toBe(senderFolderName('A'.repeat(139) + 'C'));
  });
});
