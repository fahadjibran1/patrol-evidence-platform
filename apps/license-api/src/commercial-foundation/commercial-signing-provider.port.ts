import type { KeyObject } from 'crypto';

export const COMMERCIAL_SIGNING_PROVIDER = Symbol('COMMERCIAL_SIGNING_PROVIDER');

/** Compatible with a future Key Vault/HSM provider; callers never receive private key material. */
export interface CommercialSigningProvider {
  readonly keyId: string;
  sign(payload: Buffer): Promise<Buffer>;
  verificationKey(): Promise<KeyObject>;
}
