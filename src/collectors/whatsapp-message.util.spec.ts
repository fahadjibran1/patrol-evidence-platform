import { PatrolSourceType } from '@/common/enums/patrol-source-type.enum';
import { getMessageGroupId, getMessageSourceId } from './whatsapp-message.util';

describe('getMessageSourceId', () => {
  it('uses message.from for normal group messages', () => {
    expect(getMessageSourceId({ from: '12345@g.us', to: '447700900000@c.us' })).toEqual({
      externalId: '12345@g.us',
      sourceType: PatrolSourceType.GROUP,
    });
  });

  it('uses message.to for linked-device self-sent group messages', () => {
    expect(getMessageSourceId({ from: '447700900000@c.us', to: '12345@g.us', fromMe: true })).toEqual({
      externalId: '12345@g.us',
      sourceType: PatrolSourceType.GROUP,
    });
  });

  it('uses sender contact for direct messages', () => {
    expect(
      getMessageSourceId({
        from: '447700900000@c.us',
        to: '447700900001@c.us',
        fromMe: false,
      }),
    ).toEqual({
      externalId: '447700900000@c.us',
      sourceType: PatrolSourceType.CONTACT,
    });
  });

  it('uses recipient contact for self-sent direct messages', () => {
    expect(
      getMessageSourceId({
        from: '447700900001@c.us',
        to: '447700900000@c.us',
        fromMe: true,
      }),
    ).toEqual({
      externalId: '447700900000@c.us',
      sourceType: PatrolSourceType.CONTACT,
    });
  });

  it('uses message.id.remote when from/to are direct chats in a group context', () => {
    expect(
      getMessageSourceId({
        from: '447700900000@c.us',
        to: '447700900001@c.us',
        id: { remote: '12345@g.us' },
      }),
    ).toEqual({
      externalId: '12345@g.us',
      sourceType: PatrolSourceType.GROUP,
    });
  });
});

describe('getMessageGroupId', () => {
  it('returns external chat id for groups and contacts', () => {
    expect(getMessageGroupId({ from: '12345@g.us', to: '447700900000@c.us' })).toBe('12345@g.us');
    expect(
      getMessageGroupId({
        from: '447700900000@c.us',
        to: '447700900001@c.us',
        fromMe: false,
      }),
    ).toBe('447700900000@c.us');
  });
});
