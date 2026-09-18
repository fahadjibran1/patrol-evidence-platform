export interface BackendListenConfig {
  port: number;
  host?: string;
}

export function resolveBackendListenConfig(environment: NodeJS.ProcessEnv = process.env): BackendListenConfig {
  const configuredPort = Number(environment.PORT ?? 3000);
  const desktopMode = Boolean(environment.DESKTOP_CONFIG_PATH?.trim());
  const minimumPort = desktopMode ? 0 : 1;
  const port = Number.isInteger(configuredPort) && configuredPort >= minimumPort && configuredPort <= 65535
    ? configuredPort
    : 3000;

  if (desktopMode) {
    return { port, host: '127.0.0.1' };
  }

  const host = environment.HOST?.trim();
  return host ? { port, host } : { port };
}
