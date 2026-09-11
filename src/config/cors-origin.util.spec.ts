import { createPatrolSafeCorsOriginValidator, isAllowedPatrolSafeOrigin } from './cors-origin.util';

describe('PatrolSafe local CORS origin policy', () => {
  const productionDesktop = { desktopMode: true, developmentMode: false };

  it('accepts packaged file renderer and origin-less local process traffic', () => {
    expect(isAllowedPatrolSafeOrigin('null', productionDesktop)).toBe(true);
    expect(isAllowedPatrolSafeOrigin(undefined, productionDesktop)).toBe(true);
  });

  it.each(['https://attacker.example', 'http://attacker.example', 'http://localhost:5173'])(
    'rejects arbitrary production origin %s',
    (origin) => expect(isAllowedPatrolSafeOrigin(origin, productionDesktop)).toBe(false),
  );

  it('allows exact development origins only in development mode', () => {
    expect(isAllowedPatrolSafeOrigin('http://localhost:5173', { desktopMode: true, developmentMode: true })).toBe(true);
    expect(isAllowedPatrolSafeOrigin('http://localhost:5174', { desktopMode: true, developmentMode: true })).toBe(false);
  });

  it('fails a malicious preflight origin through the callback contract', () => {
    const callback = jest.fn();
    createPatrolSafeCorsOriginValidator(productionDesktop)('https://attacker.example', callback);
    expect(callback).toHaveBeenCalledWith(expect.any(Error));
  });
});
