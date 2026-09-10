import { PatrolSourceType } from '@/common/enums/patrol-source-type.enum';
import {
  getMessageGroupId,
  getMessageSourceId,
  isDetachedFrameError,
  normalizeCanonicalWhatsAppMessageId,
  resolveWhatsAppSenderName,
  resolveCanonicalWhatsAppMessageId,
  runCanonicalMessageOperationOnce,
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

describe('current WhatsApp message identity compatibility', () => {
  it('accepts the legacy canonical serialized identity', () => {
    const message = { id: { _serialized: 'false_group_message' } };
    expect(resolveCanonicalWhatsAppMessageId(message)).toBe('false_group_message');
    expect(normalizeCanonicalWhatsAppMessageId(message)).toBe('false_group_message');
  });

  it('normalizes the current live MsgKey $1 identity for whatsapp-web.js 1.34.7', () => {
    const message: { id: { $1: string; _serialized?: string }; _data: { id: { $1: string } } } = {
      id: { $1: 'false_group_message' },
      _data: { id: { $1: 'false_group_message' } },
    };
    expect(resolveCanonicalWhatsAppMessageId(message)).toBe('false_group_message');
    expect(normalizeCanonicalWhatsAppMessageId(message)).toBe('false_group_message');
    expect(message.id._serialized).toBe('false_group_message');
  });

  it('uses the same canonical identity for duplicate event wrappers', () => {
    const created = { id: { $1: 'false_group_message' } };
    const received = { id: { $1: 'false_group_message' } };
    expect(normalizeCanonicalWhatsAppMessageId(created)).toBe(
      normalizeCanonicalWhatsAppMessageId(received),
    );
  });

  it('rejects unsupported message identity shapes without inventing an id', () => {
    const message = { id: { id: 'component-only', remote: 'group@g.us' } };
    expect(resolveCanonicalWhatsAppMessageId(message)).toBeNull();
    expect(normalizeCanonicalWhatsAppMessageId(message)).toBeNull();
  });

  it('coalesces duplicate callbacks into one media operation', async () => {
    const inFlight = new Map<string, Promise<string>>();
    let release!: (value: string) => void;
    const mediaOperation = jest.fn(
      () => new Promise<string>((resolve) => {
        release = resolve;
      }),
    );

    const first = runCanonicalMessageOperationOnce(inFlight, 'false_group_message', mediaOperation);
    const second = runCanonicalMessageOperationOnce(inFlight, 'false_group_message', mediaOperation);
    await Promise.resolve();
    expect(mediaOperation).toHaveBeenCalledTimes(1);
    release('downloaded');

    await expect(first).resolves.toEqual({ joined: false, result: 'downloaded' });
    await expect(second).resolves.toEqual({ joined: true, result: 'downloaded' });
    expect(inFlight.size).toBe(0);
  });

  it('clears a failed in-flight operation without treating it as success', async () => {
    const inFlight = new Map<string, Promise<string>>();
    await expect(
      runCanonicalMessageOperationOnce(inFlight, 'false_group_message', async () => {
        throw new Error('download failed');
      }),
    ).rejects.toThrow('download failed');
    expect(inFlight.size).toBe(0);
  });
});
