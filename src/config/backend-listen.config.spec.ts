import 'reflect-metadata';
import { resolveBackendListenConfig } from './backend-listen.config';
import { validateEnv } from './validate-env';

describe('backend listen configuration', () => {
  it('binds Electron desktop runtime to IPv4 loopback', () => {
    expect(resolveBackendListenConfig({ DESKTOP_CONFIG_PATH: 'C:\\test\\workspace.json', PORT: '3011' })).toEqual({
      host: '127.0.0.1',
      port: 3011,
    });
  });

  it('allows the operating system to allocate a private desktop port', () => {
    expect(validateEnv({ PORT: '0' }).PORT).toBe(0);
    expect(resolveBackendListenConfig({ DESKTOP_CONFIG_PATH: 'C:\\test\\workspace.json', PORT: '0' })).toEqual({
      host: '127.0.0.1',
      port: 0,
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
