import {
  normalizeWhatsAppSourceId,
  projectWhatsAppSources,
} from './whatsapp-source-discovery.util';

describe('WhatsApp source discovery projection', () => {
  it('normalizes current and legacy canonical chat identity shapes', () => {
    expect(normalizeWhatsAppSourceId({ _serialized: '120363000001@g.us' })).toBe('120363000001@g.us');
    expect(normalizeWhatsAppSourceId({ $1: '120363000002@g.us' })).toBe('120363000002@g.us');
    expect(normalizeWhatsAppSourceId({ user: '447700000000', server: 'c.us' })).toBe('447700000000@c.us');
  });

  it('returns group display names without requiring customers to enter raw IDs', () => {
    const result = projectWhatsAppSources([
      {
        id: { $1: '120363000001@g.us' },
        isGroup: true,
        formattedTitle: 'UAT Patrol Group',
        unreadCount: 2,
      },
    ]);

    expect(result.groups).toEqual([
      expect.objectContaining({ id: '120363000001@g.us', name: 'UAT Patrol Group', sourceType: 'group' }),
    ]);
    expect(result.contacts).toEqual([]);
  });

  it('handles contacts, removes duplicates, and rejects unstable identifiers', () => {
    const result = projectWhatsAppSources([
      { id: '447700000000@c.us', name: 'UAT Guard' },
      { id: { _serialized: '447700000000@c.us' }, formattedTitle: 'Duplicate' },
      { id: { _serialized: 'not-a-source' }, formattedTitle: 'Invalid' },
    ]);

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]).toEqual(expect.objectContaining({ name: 'UAT Guard', sourceType: 'contact' }));
  });

  it('uses customer-safe generic labels instead of exposing an ID as a display name', () => {
    const result = projectWhatsAppSources([
      { id: { _serialized: '120363000001@g.us' }, isGroup: true },
      { id: { _serialized: '447700000000@c.us' } },
    ]);

    expect(result.groups[0]?.name).toBe('WhatsApp group');
    expect(result.contacts[0]?.name).toBe('WhatsApp contact');
  });
});
