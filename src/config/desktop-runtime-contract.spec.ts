// eslint-disable-next-line @typescript-eslint/no-require-imports
const runtimeContract = require('../../desktop/runtime-contract') as {
  DEFAULT_BACKEND_PORT: number;
  getApiBaseUrl(port: number): string;
  getApiBaseUrlArgument(port: number): string;
  normalizeBackendPort(value: unknown): number;
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
});
