export interface BackendListenConfig {
  port: number;
  host?: string;
}

export function resolveBackendListenConfig(environment: NodeJS.ProcessEnv = process.env): BackendListenConfig {
  const configuredPort = Number(environment.PORT ?? 3000);
  const port = Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535
    ? configuredPort
    : 3000;

  if (environment.DESKTOP_CONFIG_PATH?.trim()) {
    return { port, host: '127.0.0.1' };
  }

  const host = environment.HOST?.trim();
  return host ? { port, host } : { port };
}
