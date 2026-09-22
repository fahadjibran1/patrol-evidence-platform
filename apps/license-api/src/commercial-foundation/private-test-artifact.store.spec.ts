import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { PrivateTestArtifactStore } from './private-test-artifact.store';

describe('private commercial artifact store', () => {
  let root: string;
  let store: PrivateTestArtifactStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'patrolsafe-phase4-artifacts-'));
    store = new PrivateTestArtifactStore(new ConfigService({ NODE_ENV: 'test', COMMERCIAL_TEST_ISSUER_ENABLED: 'true', COMMERCIAL_TEST_ARTIFACT_ROOT: root }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('returns only an immutable regular file matching size and SHA-256', async () => {
    const bytes = Buffer.from('{"test":"phase4"}');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const stored = await store.putImmutable({ issuanceId: 'issuance-test', fileName: 'PatrolSafe-Test.tglic', sha256, bytes });
    await expect(store.readVerified({ storageKey: stored.storageKey, sha256, byteSize: stored.byteSize })).resolves.toEqual(bytes);
    await writeFile(resolve(root, ...stored.storageKey.split('/')), 'tampered');
    await expect(store.readVerified({ storageKey: stored.storageKey, sha256, byteSize: stored.byteSize })).rejects.toMatchObject({ code: 'COMMERCIAL_ARTIFACT_INTEGRITY_FAILED' });
  });

  it('rejects traversal and missing objects without exposing a path', async () => {
    await expect(store.readVerified({ storageKey: '../outside.tglic', sha256: 'a'.repeat(64), byteSize: 1n })).rejects.toMatchObject({ code: 'COMMERCIAL_ARTIFACT_INTEGRITY_FAILED' });
  });
});
