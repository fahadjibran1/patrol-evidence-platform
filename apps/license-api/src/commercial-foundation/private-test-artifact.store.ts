import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { mkdir, open, readFile, rename, unlink } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';
import type { CommercialArtifactStore, StoredCommercialArtifact } from './commercial-artifact-store.port';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

export class PrivateTestArtifactStore implements CommercialArtifactStore {
  constructor(private readonly config: ConfigService) {}

  async putImmutable(input: {
    issuanceId: string;
    sha256: string;
    fileName: string;
    bytes: Buffer;
  }): Promise<StoredCommercialArtifact> {
    const root = this.root();
    if (!/^[a-f0-9]{64}$/.test(input.sha256) || !/^[A-Za-z0-9._-]+\.tglic$/.test(input.fileName)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED, 'Artifact identity is invalid.', 500);
    }
    if (this.hash(input.bytes) !== input.sha256) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED, 'Artifact content hash does not match its immutable identity.', 409);
    }
    const storageKey = `${input.issuanceId}/${input.sha256}/${input.fileName}`;
    const target = resolve(root, ...storageKey.split('/'));
    if (!target.startsWith(`${root}${sep}`)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED, 'Artifact path is invalid.', 500);
    }
    await mkdir(dirname(target), { recursive: true });
    try {
      const existing = await readFile(target);
      if (this.hash(existing) !== input.sha256) throw new Error('immutable artifact collision');
      return { storageKey, byteSize: BigInt(existing.byteLength) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if ((error as Error).message === 'immutable artifact collision') {
          throw new ApiException(ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED, 'Immutable artifact collision.', 409);
        }
        throw new ApiException(ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED, 'Private artifact storage is unavailable.', 503);
      }
    }
    const temp = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(input.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, target);
    } catch {
      await unlink(temp).catch(() => undefined);
      try {
        const existing = await readFile(target);
        if (this.hash(existing) === input.sha256) return { storageKey, byteSize: BigInt(existing.byteLength) };
      } catch {
        // The target is still absent or unreadable; return a sanitized storage failure below.
      }
      throw new ApiException(ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED, 'Private artifact storage failed.', 503);
    }
    return { storageKey, byteSize: BigInt(input.bytes.byteLength) };
  }

  private root(): string {
    const env = this.config.get<string>('NODE_ENV') ?? 'development';
    const configured = this.config.get<string>('COMMERCIAL_TEST_ARTIFACT_ROOT')?.trim() ?? '';
    if (env === 'production' || this.config.get<string>('COMMERCIAL_TEST_ISSUER_ENABLED') !== 'true') {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ISSUER_DISABLED, 'Test artifact storage is disabled.', 503);
    }
    if (!configured || !isAbsolute(configured)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED, 'Absolute private test artifact storage is required.', 503);
    }
    const root = resolve(configured);
    const fromRepository = relative(resolve(process.cwd()), root);
    if (fromRepository !== '..' && !fromRepository.startsWith(`..${sep}`)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED, 'Test artifacts must be stored outside committed source.', 503);
    }
    return root;
  }

  private hash(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
  }
}
