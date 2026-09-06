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

  it('installs the identity index and records an idempotent migration', async () => {
    const dataSource = {
      options: { type: 'better-sqlite3' },
      query: jest.fn().mockResolvedValue([]),
    };
    await new PatrolImageSchemaService(dataSource as never).onModuleInit();
    expect(dataSource.query.mock.calls.some(([sql]: [string]) => sql.includes('CREATE UNIQUE INDEX'))).toBe(true);
    expect(dataSource.query.mock.calls.some(([sql]: [string]) => sql.includes('patrol-images-identity-v1'))).toBe(true);
  });
});
