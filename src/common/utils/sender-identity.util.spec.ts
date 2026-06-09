import {
  buildSenderPersonKey,
  buildSiteSenderMergeKey,
  canonicalSenderKey,
  resolvePatrolSender,
  senderIdentityKeysOverlap,
  stripSourceFromSenderName,
} from './sender-identity.util';

describe('sender-identity.util', () => {
  it('strips mapped source suffix from sender display names', () => {
    expect(stripSourceFromSenderName('FAISU 💖 / Corner Copse - Swindon')).toBe('FAISU 💖');
  });

  it('prefers senderExternalId over sender number for canonical keys', () => {
    expect(
      canonicalSenderKey({
        senderExternalId: '447700000001@c.us',
        senderNumber: '447700000001',
      }),
    ).toBe('ext:447700000001@c.us');
    expect(canonicalSenderKey({ senderNumber: '447700000001' })).toBe('tel:447700000001');
  });

  it('does not use display name as a canonical sender key', () => {
    expect(canonicalSenderKey({ senderName: 'Muhammad Arsalan' })).toBeNull();
    expect(
      canonicalSenderKey({
        senderName: 'Muhammad Arsalan / Corner Copse - Swindon',
      }),
    ).toBeNull();
  });

  it('merges sender identities when external id and phone refer to the same person', () => {
    const fromNumber = {
      senderNumber: '447700000001',
    };
    const fromExternal = {
      senderExternalId: '447700000001@c.us',
    };

    expect(senderIdentityKeysOverlap(fromNumber, fromExternal)).toBe(true);
    expect(buildSiteSenderMergeKey('site-1', fromExternal)).toBe('site-1::ext:447700000001@c.us');
    expect(buildSiteSenderMergeKey('site-1', fromNumber)).toBe('site-1::tel:447700000001');
  });

  it('builds separate guard and source labels', () => {
    const resolved = resolvePatrolSender({
      senderNumber: '447700000001',
      senderName: 'FAISU 💖',
      sourceLabel: 'Corner Copse - Swindon',
    });

    expect(resolved).toEqual({
      senderKey: 'tel:447700000001',
      guardName: 'FAISU 💖',
      sourceLabel: 'Corner Copse - Swindon',
    });
    expect(buildSenderPersonKey('tel:447700000001')).toBe('sender:tel:447700000001');
  });
});
