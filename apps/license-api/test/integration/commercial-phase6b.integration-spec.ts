import { createHash } from 'crypto';
import { EncryptionService } from '@/crypto/encryption.service';
import { DatabaseCommercialArtifactStore } from '@/commercial-foundation/database-commercial-artifact.store';
import {
  closeIntegrationContext,
  createIntegrationContext,
  type IntegrationContext,
} from './integration-harness';

describe('commercial Phase 6B lean database artifact storage', () => {
  let context: IntegrationContext;

  beforeAll(async () => {
    context = await createIntegrationContext();
  });

  afterAll(async () => {
    await closeIntegrationContext(context);
  });

  it('persists only encrypted immutable bytes and verifies them on read', async () => {
    const store = new DatabaseCommercialArtifactStore(
      context.prisma,
      context.module.get(EncryptionService),
    );
    const bytes = Buffer.from('{"payload":{"environment":"phase6b"},"signature":"test-only"}');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const stored = await store.putImmutable({
      issuanceId: '33333333-3333-4333-8333-333333333333',
      fileName: 'PatrolSafe-Staging-Test.tglic',
      sha256,
      bytes,
    });

    const row = await context.prisma.commercialArtifactBlob.findUniqueOrThrow({
      where: { storageKey: stored.storageKey },
    });
    expect(row.ciphertext).not.toContain(bytes.toString('utf8'));
    await expect(store.readVerified({ ...stored, sha256 })).resolves.toEqual(bytes);
  });
});
