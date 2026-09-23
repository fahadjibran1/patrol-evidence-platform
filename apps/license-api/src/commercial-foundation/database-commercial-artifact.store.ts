import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { EncryptionService } from '@/crypto/encryption.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import type { CommercialArtifactStore, StoredCommercialArtifact } from './commercial-artifact-store.port';

export class DatabaseCommercialArtifactStore implements CommercialArtifactStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async putImmutable(input: {
    issuanceId: string;
    sha256: string;
    fileName: string;
    bytes: Buffer;
  }): Promise<StoredCommercialArtifact> {
    this.validateIdentity(input.sha256, input.issuanceId, input.fileName);
    if (this.hash(input.bytes) !== input.sha256) {
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED,
        'Artifact content hash does not match its immutable identity.',
        409,
      );
    }
    const storageKey = `database/${input.issuanceId}/${input.sha256}/${input.fileName}`;
    const existing = await this.prisma.commercialArtifactBlob.findUnique({ where: { storageKey } });
    if (existing) return this.verifyExisting(existing, input.sha256, input.bytes);

    try {
      await this.prisma.commercialArtifactBlob.create({
        data: {
          storageKey,
          sha256: input.sha256,
          byteSize: BigInt(input.bytes.byteLength),
          ciphertext: this.encryption.encrypt(input.bytes.toString('base64')),
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw new ApiException(
          ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED,
          'Private database artifact storage is unavailable.',
          503,
        );
      }
      const raced = await this.prisma.commercialArtifactBlob.findUnique({ where: { storageKey } });
      if (!raced) {
        throw new ApiException(
          ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED,
          'Private database artifact storage is unavailable.',
          503,
        );
      }
      return this.verifyExisting(raced, input.sha256, input.bytes);
    }
    return { storageKey, byteSize: BigInt(input.bytes.byteLength) };
  }

  async readVerified(input: { storageKey: string; sha256: string; byteSize: bigint }): Promise<Buffer> {
    if (!/^database\/[0-9a-f-]{36}\/[a-f0-9]{64}\/[A-Za-z0-9._-]+\.tglic$/.test(input.storageKey)
      || !/^[a-f0-9]{64}$/.test(input.sha256)) {
      throw this.integrityError();
    }
    try {
      const stored = await this.prisma.commercialArtifactBlob.findUnique({ where: { storageKey: input.storageKey } });
      if (!stored || stored.sha256 !== input.sha256 || stored.byteSize !== input.byteSize) throw new Error('metadata mismatch');
      const bytes = Buffer.from(this.encryption.decrypt(stored.ciphertext), 'base64');
      if (BigInt(bytes.byteLength) !== input.byteSize || this.hash(bytes) !== input.sha256) throw new Error('integrity mismatch');
      return bytes;
    } catch {
      throw this.integrityError();
    }
  }

  private verifyExisting(
    existing: { storageKey: string; sha256: string; byteSize: bigint; ciphertext: string },
    expectedHash: string,
    expectedBytes: Buffer,
  ): StoredCommercialArtifact {
    try {
      const bytes = Buffer.from(this.encryption.decrypt(existing.ciphertext), 'base64');
      if (
        existing.sha256 !== expectedHash
        || existing.byteSize !== BigInt(expectedBytes.byteLength)
        || this.hash(bytes) !== expectedHash
        || !bytes.equals(expectedBytes)
      ) throw new Error('immutable artifact collision');
      return { storageKey: existing.storageKey, byteSize: existing.byteSize };
    } catch {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED, 'Immutable artifact collision.', 409);
    }
  }

  private validateIdentity(sha256: string, issuanceId: string, fileName: string): void {
    if (!/^[a-f0-9]{64}$/.test(sha256)
      || !/^[0-9a-f-]{36}$/i.test(issuanceId)
      || !/^[A-Za-z0-9._-]+\.tglic$/.test(fileName)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_ARTIFACT_STORAGE_FAILED, 'Artifact identity is invalid.', 500);
    }
  }

  private hash(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  private integrityError(): ApiException {
    return new ApiException(
      ERROR_CODES.COMMERCIAL_ARTIFACT_INTEGRITY_FAILED,
      'Licence artifact is unavailable or failed integrity verification.',
      409,
    );
  }
}
