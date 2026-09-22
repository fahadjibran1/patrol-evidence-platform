import type { KeyObject } from 'crypto';
import { verifyCommercialLicence, type SignedCommercialLicence } from '@patrol/license-core';

/** Future desktop design fixture: try only explicitly trusted issuer keys. */
export function verifyWithCommercialTrustRing(input: {
  licence: SignedCommercialLicence;
  trustedKeys: ReadonlyMap<string, KeyObject>;
  installationId: string;
  machineFingerprint: string;
  today: string;
}): { valid: boolean; keyId?: string; reason?: string } {
  if (input.licence.payload.product !== 'Patrol Evidence Platform') {
    return { valid: false, reason: 'Licence product is not supported.' };
  }
  for (const [keyId, publicKey] of input.trustedKeys) {
    const result = verifyCommercialLicence({
      licence: input.licence,
      publicKey,
      installationId: input.installationId,
      machineFingerprint: input.machineFingerprint,
      today: input.today,
    });
    if (result.valid) return { valid: true, keyId };
  }
  return { valid: false, reason: 'Licence was not signed by a trusted issuer.' };
}
