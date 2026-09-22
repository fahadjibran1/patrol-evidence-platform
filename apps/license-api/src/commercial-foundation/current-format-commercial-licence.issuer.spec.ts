import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'crypto';
import { parseSignedCommercialLicenceJson, signCommercialLicencePayload, type CommercialLicencePayload } from '@patrol/license-core';
import { CurrentFormatCommercialLicenceIssuer } from './current-format-commercial-licence.issuer';
import { verifyWithCommercialTrustRing } from './commercial-licence-trust-ring';
import type { CommercialSigningProvider } from './commercial-signing-provider.port';
import type { CommercialArtifactStore } from './commercial-artifact-store.port';
import type { IssueCommercialLicenceCommand } from './commercial-issuer.port';

function keys() {
  const pair = generateKeyPairSync('ed25519');
  return { privateKey: pair.privateKey, publicKey: pair.publicKey };
}

function command(overrides: Partial<IssueCommercialLicenceCommand> = {}): IssueCommercialLicenceCommand {
  return {
    commandId: 'issuance-test-1', correlationId: 'corr-test', publicOrderId: 'ord_test', requestHash: 'a'.repeat(64),
    product: 'Patrol Evidence Platform', plan: 'annual', installationId: '8d32efec-f80c-4fc1-8cd1-6c2ac93f3c56',
    machineFingerprint: 'b'.repeat(64), companyName: 'Test Patrols Ltd', licenceId: 'lic-11111111-1111-4111-8111-111111111111',
    issuedAt: '2026-09-22T12:00:00.000Z', startsAt: '2026-09-22', expiresAt: '2027-09-21',
    features: { whatsappMonitoring: true, guardSafe: true, evidence: true, alerts: true, incidents: true, exports: true },
    maxDevices: 1, predecessorLicenceId: null, ...overrides,
  };
}

class MemorySigner implements CommercialSigningProvider {
  readonly keyId = 'test-phase3-ed25519';
  constructor(private readonly privateKey: ReturnType<typeof createPrivateKey>, private readonly publicKey: ReturnType<typeof createPublicKey>) {}
  async sign(payload: Buffer) { return sign(null, payload, this.privateKey); }
  async verificationKey() { return this.publicKey; }
}

class MemoryStore implements CommercialArtifactStore {
  values = new Map<string, Buffer>();
  async putImmutable(input: { issuanceId: string; sha256: string; fileName: string; bytes: Buffer }) {
    const key = `${input.issuanceId}/${input.sha256}/${input.fileName}`;
    const prior = this.values.get(key);
    if (prior && !prior.equals(input.bytes)) throw new Error('collision');
    this.values.set(key, input.bytes);
    return { storageKey: key, byteSize: BigInt(input.bytes.byteLength) };
  }
}

describe('current-format commercial .tglic issuer', () => {
  it('creates deterministic GA-format bytes and independently verifiable binding', async () => {
    const pair = keys();
    const store = new MemoryStore();
    const issuer = new CurrentFormatCommercialLicenceIssuer(new MemorySigner(pair.privateKey, pair.publicKey), store);
    const first = await issuer.issue(command());
    const second = await issuer.issue(command());
    expect(first).toEqual(second);
    const bytes = store.values.get(first.artifact.storageKey)!;
    const parsed = parseSignedCommercialLicenceJson(bytes.toString('utf8'))!;
    expect(parsed.payload).toEqual(expect.objectContaining({
      version: 1, product: 'Patrol Evidence Platform', plan: 'annual', maxDevices: 1,
      installationId: command().installationId, machineFingerprint: command().machineFingerprint,
      companyName: 'Test Patrols Ltd', startsAt: '2026-09-22', expiresAt: '2027-09-21',
    }));
    expect(first.signingKeyId).toBe('test-phase3-ed25519');
  });

  it('fails verification when the signer exposes the wrong verification key', async () => {
    const signing = keys();
    const wrong = keys();
    const issuer = new CurrentFormatCommercialLicenceIssuer(new MemorySigner(signing.privateKey, wrong.publicKey), new MemoryStore());
    await expect(issuer.issue(command())).rejects.toMatchObject({ code: 'COMMERCIAL_LICENCE_VERIFICATION_FAILED' });
  });

  it('rejects an invalid signing key identity before signing', async () => {
    const pair = keys();
    const signer = new MemorySigner(pair.privateKey, pair.publicKey);
    Object.defineProperty(signer, 'keyId', { value: '../wrong' });
    await expect(new CurrentFormatCommercialLicenceIssuer(signer, new MemoryStore()).issue(command())).rejects.toMatchObject({ code: 'COMMERCIAL_ISSUER_DISABLED' });
  });

  it('proves old/new trust-ring compatibility and rejects unknown/unsigned material', () => {
    const old = keys();
    const online = keys();
    const unknown = keys();
    const payload: CommercialLicencePayload = {
      version: 1, licenceId: 'lic_old', installationId: command().installationId, machineFingerprint: command().machineFingerprint,
      companyName: 'Existing Customer', plan: 'annual', issuedAt: '2026-01-01T00:00:00.000Z', startsAt: '2026-01-01', expiresAt: '2027-12-31',
      features: { ...command().features }, product: 'Patrol Evidence Platform', maxDevices: 1,
    };
    const oldLicence = signCommercialLicencePayload(payload, old.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    const newLicence = signCommercialLicencePayload({ ...payload, licenceId: 'lic_new' }, online.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    const ring = new Map([['v1-offline', old.publicKey], ['v2-online', online.publicKey]]);
    expect(verifyWithCommercialTrustRing({ licence: oldLicence, trustedKeys: ring, installationId: payload.installationId, machineFingerprint: payload.machineFingerprint, today: '2026-09-22' })).toEqual({ valid: true, keyId: 'v1-offline' });
    expect(verifyWithCommercialTrustRing({ licence: newLicence, trustedKeys: ring, installationId: payload.installationId, machineFingerprint: payload.machineFingerprint, today: '2026-09-22' })).toEqual({ valid: true, keyId: 'v2-online' });
    const unknownLicence = signCommercialLicencePayload(payload, unknown.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    expect(verifyWithCommercialTrustRing({ licence: unknownLicence, trustedKeys: ring, installationId: payload.installationId, machineFingerprint: payload.machineFingerprint, today: '2026-09-22' }).valid).toBe(false);
    expect(verifyWithCommercialTrustRing({ licence: { payload, signature: '' }, trustedKeys: ring, installationId: payload.installationId, machineFingerprint: payload.machineFingerprint, today: '2026-09-22' }).valid).toBe(false);
  });
});
