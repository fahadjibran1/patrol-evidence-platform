import { PatrolImageSchemaService } from './patrol-image-schema.service';

describe('PatrolImageSchemaService', () => {
  it('fails closed when scoped WhatsApp identities are ambiguous', async () => {
    const dataSource = {
      options: { type: 'better-sqlite3' },
      query: jest.fn()
        .mockResolvedValueOnce([{ name: 'linkedAccountId' }, { name: 'contentSha256' }, { name: 'integrityStatus' }])
        .mockResolvedValueOnce([{ linkedAccountId: 'account-a', messageExternalId: 'message-1', count: 2 }]),
    };
    await expect(new PatrolImageSchemaService(dataSource as never).onModuleInit())
      .rejects.toThrow('duplicate WhatsApp identities');
    expect(dataSource.query).toHaveBeenCalledTimes(2);
  });

  it('verifies the versioned migration installed the identity index without mutating schema', async () => {
    const dataSource = {
      options: { type: 'better-sqlite3' },
      query: jest.fn()
        .mockResolvedValueOnce([{ name: 'linkedAccountId' }, { name: 'contentSha256' }, { name: 'integrityStatus' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ name: 'UQ_patrol_images_whatsapp_identity' }]),
    };
    await new PatrolImageSchemaService(dataSource as never).onModuleInit();
    expect(dataSource.query.mock.calls.every(([sql]: [string]) => !/CREATE|ALTER|INSERT/i.test(sql))).toBe(true);
  });

  it('fails closed when a required migrated column is absent', async () => {
    const dataSource = {
      options: { type: 'better-sqlite3' },
      query: jest.fn().mockResolvedValueOnce([{ name: 'linkedAccountId' }]),
    };
    await expect(new PatrolImageSchemaService(dataSource as never).onModuleInit())
      .rejects.toThrow('contentSha256 is missing');
  });
});
