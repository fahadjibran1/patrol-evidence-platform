export const COMMERCIAL_ARTIFACT_STORE = Symbol('COMMERCIAL_ARTIFACT_STORE');

export interface StoredCommercialArtifact {
  storageKey: string;
  byteSize: bigint;
}

export interface CommercialArtifactStore {
  putImmutable(input: {
    issuanceId: string;
    sha256: string;
    fileName: string;
    bytes: Buffer;
  }): Promise<StoredCommercialArtifact>;
  readVerified(input: {
    storageKey: string;
    sha256: string;
    byteSize: bigint;
  }): Promise<Buffer>;
}
