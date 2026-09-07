// eslint-disable-next-line @typescript-eslint/no-require-imports
const runtimeContract = require('../../desktop/runtime-contract') as {
  DEFAULT_BACKEND_PORT: number;
  getApiBaseUrl(port: number): string;
  getApiBaseUrlArgument(port: number): string;
  normalizeBackendPort(value: unknown): number;
  isExplicitCertificationLaunch(environment: NodeJS.ProcessEnv, argv: string[]): boolean;
  getBackendProcessArguments(entryPoint: string, environment: NodeJS.ProcessEnv, argv: string[], additionalArgs?: string[]): string[];
};

describe('desktop runtime contract', () => {
  it('preserves port 3001 as the default', () => {
    expect(runtimeContract.getApiBaseUrl(runtimeContract.DEFAULT_BACKEND_PORT)).toBe('http://localhost:3001');
    expect(runtimeContract.getApiBaseUrlArgument(3001)).toBe(
      '--patrol-api-base-url=http://localhost:3001',
    );
  });

  it('passes a selected non-default backend port to the renderer', () => {
    expect(runtimeContract.getApiBaseUrlArgument(3011)).toBe(
      '--patrol-api-base-url=http://localhost:3011',
    );
  });

  it('rejects invalid or non-local port values', () => {
    expect(runtimeContract.normalizeBackendPort('not-a-port')).toBe(3001);
    expect(runtimeContract.normalizeBackendPort(70000)).toBe(3001);
  });

  it('forwards the certification marker only when both activation factors are present', () => {
    const marker = '--patrol-certification-qr-only';
    expect(
      runtimeContract.getBackendProcessArguments('dist/main.js', {
        PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED: 'true',
      }, ['electron']),
    ).toEqual(['dist/main.js']);
    expect(runtimeContract.getBackendProcessArguments('dist/main.js', {}, ['electron', marker])).toEqual([
      'dist/main.js',
    ]);
    expect(
      runtimeContract.getBackendProcessArguments(
        'dist/main.js',
        { PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED: 'true' },
        ['electron', marker],
      ),
    ).toEqual(['dist/main.js', marker]);
  });

  it('preserves development backend arguments while appending the marker', () => {
    const marker = '--patrol-certification-qr-only';
    expect(runtimeContract.getBackendProcessArguments(
      'node_modules/@nestjs/cli/bin/nest.js',
      { PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED: 'true' },
      ['electron', marker],
      ['start', '--watch', '--exec', 'electron'],
    )).toEqual([
      'node_modules/@nestjs/cli/bin/nest.js',
      'start', '--watch', '--exec', 'electron', marker,
    ]);
  });

  it('keeps certification launch detection dual-factor', () => {
    const marker = '--patrol-certification-qr-only';
    expect(runtimeContract.isExplicitCertificationLaunch({}, ['electron', marker])).toBe(false);
    expect(runtimeContract.isExplicitCertificationLaunch(
      { PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED: 'true' },
      ['electron'],
    )).toBe(false);
    expect(runtimeContract.isExplicitCertificationLaunch(
      { PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED: 'true' },
      ['electron', marker],
    )).toBe(true);
  });
});
