import { resolveBackendListenConfig } from './backend-listen.config';

describe('backend listen configuration', () => {
  it('binds Electron desktop runtime to IPv4 loopback', () => {
    expect(resolveBackendListenConfig({ DESKTOP_CONFIG_PATH: 'C:\\test\\workspace.json', PORT: '3011' })).toEqual({
      host: '127.0.0.1',
      port: 3011,
    });
  });

  it('preserves standalone default binding and configured server host', () => {
    expect(resolveBackendListenConfig({ PORT: '3000' })).toEqual({ port: 3000 });
    expect(resolveBackendListenConfig({ PORT: '4000', HOST: '0.0.0.0' })).toEqual({ host: '0.0.0.0', port: 4000 });
  });

  it('falls back safely when the configured port is invalid', () => {
    expect(resolveBackendListenConfig({ DESKTOP_CONFIG_PATH: 'workspace.json', PORT: '70000' })).toEqual({
      host: '127.0.0.1',
      port: 3000,
    });
  });
});
