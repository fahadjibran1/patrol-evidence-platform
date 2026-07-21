import { PatrolSourceType } from '@/common/enums/patrol-source-type.enum';
import {
  getMessageGroupId,
  getMessageSourceId,
  isDetachedFrameError,
  resolveWhatsAppSenderName,
  shouldSkipWhatsAppFromMe,
  withDetachedFrameRetry,
} from './whatsapp-message.util';

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

describe('fromMe and sender identity helpers', () => {
  it('skips fromMe when allowFromMe is disabled', () => {
    expect(shouldSkipWhatsAppFromMe(true, false)).toBe(true);
    expect(shouldSkipWhatsAppFromMe(true, true)).toBe(false);
    expect(shouldSkipWhatsAppFromMe(false, false)).toBe(false);
  });

  it('falls back to sender number for generic WhatsApp contact names', () => {
    expect(
      resolveWhatsAppSenderName({
        pushname: 'WhatsApp',
        name: '',
        shortName: '',
        senderNumber: '447700111222',
        fromMe: false,
      }),
    ).toBe('447700111222');
  });

  it('keeps a usable pushname when present', () => {
    expect(
      resolveWhatsAppSenderName({
        pushname: 'Guard One',
        name: 'Guard One',
        shortName: 'Guard',
        senderNumber: '447700000000',
        fromMe: true,
      }),
    ).toBe('Guard One');
  });
});

describe('detached-frame retry', () => {
  it('retries once for detached frame errors and then succeeds', async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce(new Error("Attempted to use detached Frame 'frame-1'."))
      .mockResolvedValueOnce(['ok']);

    await expect(withDetachedFrameRetry(() => operation())).resolves.toEqual(['ok']);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(isDetachedFrameError(new Error("Attempted to use detached Frame 'frame-1'."))).toBe(true);
  });

  it('does not retry unrelated errors', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('network failure'));
    await expect(withDetachedFrameRetry(() => operation())).rejects.toThrow('network failure');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
