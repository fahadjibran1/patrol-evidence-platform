import { DisabledCommercialLicenceIssuer } from './commercial-issuer.port';

describe('DisabledCommercialLicenceIssuer', () => {
  it('fails closed without loading or using a signing key', async () => {
    const issuer = new DisabledCommercialLicenceIssuer();
    await expect(issuer.issue({} as never)).rejects.toMatchObject({
      code: 'COMMERCIAL_ISSUER_DISABLED',
    });
  });
});
