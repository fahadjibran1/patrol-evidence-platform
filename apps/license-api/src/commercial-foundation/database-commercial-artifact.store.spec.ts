import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { EncryptionService } from '@/crypto/encryption.service';
import type { PrismaService } from '@/prisma/prisma.service';
import { DatabaseCommercialArtifactStore } from './database-commercial-artifact.store';

interface ArtifactRow {
  storageKey: string;
  sha256: string;
  byteSize: bigint;
  ciphertext: string;
  createdAt: Date;
}

describe('database commercial artifact store', () => {
  const rows = new Map<string, ArtifactRow>();
  const model = {
    findUnique: jest.fn(async ({ where }: { where: { storageKey: string } }) => rows.get(where.storageKey) ?? null),
    create: jest.fn(async ({ data }: { data: Omit<ArtifactRow, 'createdAt'> }) => {
      const row = { ...data, createdAt: new Date() };
      rows.set(row.storageKey, row);
      return row;
    }),
  };
  const prisma = { commercialArtifactBlob: model } as unknown as PrismaService;
  const encryption = new EncryptionService(new ConfigService({ LICENCE_STORAGE_ENCRYPTION_KEY: 'a'.repeat(64) }));
  const store = new DatabaseCommercialArtifactStore(prisma, encryption);

  beforeEach(() => {
    rows.clear();
    jest.clearAllMocks();
  });

  it('encrypts, stores once, and verifies the immutable licence bytes', async () => {
    const bytes = Buffer.from('{"payload":{"test":"phase6b"},"signature":"test"}');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const input = {
      issuanceId: '11111111-1111-4111-8111-111111111111',
      fileName: 'PatrolSafe-Test.tglic',
      sha256,
      bytes,
    };

    const first = await store.putImmutable(input);
    const second = await store.putImmutable(input);

    expect(first).toEqual(second);
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(rows.get(first.storageKey)?.ciphertext).not.toContain(bytes.toString('utf8'));
    await expect(store.readVerified({ ...first, sha256 })).resolves.toEqual(bytes);
  });

  it('fails closed for a tampered encrypted blob or customer-controlled key', async () => {
    const bytes = Buffer.from('test licence bytes');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const stored = await store.putImmutable({
      issuanceId: '22222222-2222-4222-8222-222222222222',
      fileName: 'PatrolSafe-Test.tglic',
      sha256,
      bytes,
    });
    const row = rows.get(stored.storageKey)!;
    row.ciphertext = `${row.ciphertext.slice(0, -2)}00`;

    await expect(store.readVerified({ ...stored, sha256 })).rejects.toMatchObject({
      code: 'COMMERCIAL_ARTIFACT_INTEGRITY_FAILED',
    });
    await expect(store.readVerified({ storageKey: '../other.tglic', sha256, byteSize: stored.byteSize }))
      .rejects.toMatchObject({ code: 'COMMERCIAL_ARTIFACT_INTEGRITY_FAILED' });
  });
});
