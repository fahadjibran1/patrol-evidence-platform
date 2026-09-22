import { PurchaseRequestValidator } from './purchase-request.validator';
import { COMMERCIAL_PRODUCT, PURCHASE_REQUEST_SCHEMA_VERSION } from './commercial.constants';

const VALID = {
  requestId: '71d0713e-d2d6-4a57-8c1e-3aa01b393f37',
  schemaVersion: PURCHASE_REQUEST_SCHEMA_VERSION,
  product: COMMERCIAL_PRODUCT,
  plan: 'annual',
  installationId: 'dc87bfd8-30e7-40b2-a5e5-44844a7ef77d',
  machineFingerprint: 'A'.repeat(64),
  companyName: '  Northstar   Security Ltd  ',
  appVersion: '1.0.3',
  buildId: '2026.09.22.phase1',
  clientNonce: 'nonce_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

describe('PurchaseRequestValidator', () => {
  const validator = new PurchaseRequestValidator();

  it('canonicalizes a valid annual request deterministically', async () => {
    const first = await validator.validate(VALID);
    const second = await validator.validate({ ...VALID, machineFingerprint: 'a'.repeat(64) });

    expect(first.request.companyName).toBe('Northstar Security Ltd');
    expect(first.request.machineFingerprint).toBe('a'.repeat(64));
    expect(first.canonicalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.canonicalHash).toBe(first.canonicalHash);
  });

  it.each([
    ['wrong product', { product: 'Something Else' }],
    ['wrong plan', { plan: 'monthly' }],
    ['unknown field', { price: 29900 }],
    ['malformed installation ID', { installationId: 'machine-one' }],
    ['malformed fingerprint', { machineFingerprint: 'not-a-fingerprint' }],
    ['oversized company', { companyName: 'A'.repeat(161) }],
    ['short nonce', { clientNonce: 'too-short' }],
    ['bad previous licence', { previousLicenceId: 'TG1-old' }],
  ])('rejects %s', async (_label, replacement) => {
    await expect(validator.validate({ ...VALID, ...replacement })).rejects.toMatchObject({
      code: 'COMMERCIAL_REQUEST_INVALID',
    });
  });
});
