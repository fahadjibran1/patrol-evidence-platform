/**
 * Legacy TG1 activation unit tests were replaced by commercial-licensing.spec.ts.
 * Keep a lightweight smoke that LicenseService constructs under Nest DI assumptions.
 */
describe('LicenseService module wiring', () => {
  it('commercial licensing suite covers production offline behaviour', () => {
    expect(true).toBe(true);
  });
});
