import { ConfigService } from '@nestjs/config';
import { TestFileEd25519SigningProvider } from './test-file-ed25519-signing.provider';
import { PrivateTestArtifactStore } from './private-test-artifact.store';

describe('Phase 3 test issuer production boundary', () => {
  const values: Record<string, string> = {
    NODE_ENV: 'production',
    COMMERCIAL_TEST_ISSUER_ENABLED: 'true',
    COMMERCIAL_TEST_SIGNING_KEY_ID: 'test-must-never-run',
    COMMERCIAL_TEST_SIGNING_PRIVATE_KEY_FILE: 'C:/outside/test-key.pem',
    COMMERCIAL_TEST_ARTIFACT_ROOT: 'C:/outside/test-artifacts',
  };
  const production = { get: (key: string) => values[key] } as ConfigService;

  it('refuses to load or use the test signing adapter in production', async () => {
    const provider = new TestFileEd25519SigningProvider(production);
    await expect(provider.sign(Buffer.from('never-sign'))).rejects.toMatchObject({ code: 'COMMERCIAL_ISSUER_DISABLED' });
  });

  it('refuses test artifact storage in production', async () => {
    const store = new PrivateTestArtifactStore(production);
    await expect(store.putImmutable({ issuanceId: 'test', sha256: 'a'.repeat(64), fileName: 'test.tglic', bytes: Buffer.from('{}') })).rejects.toMatchObject({ code: 'COMMERCIAL_ISSUER_DISABLED' });
  });
});
