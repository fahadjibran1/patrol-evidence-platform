export const DESKTOP_API_TOKEN_HEADER = 'x-patrolsafe-desktop-token';

const DEFAULT_DEVELOPMENT_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

export interface DesktopCorsPolicyOptions {
  desktopMode: boolean;
  developmentMode: boolean;
  configuredDevelopmentOrigins?: string;
}

export function resolveAllowedDevelopmentOrigins(configured?: string): Set<string> {
  if (!configured?.trim()) {
    return new Set(DEFAULT_DEVELOPMENT_ORIGINS);
  }

  return new Set(
    configured
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function isAllowedPatrolSafeOrigin(
  origin: string | undefined,
  options: DesktopCorsPolicyOptions,
): boolean {
  // Node helpers and local process health probes do not send Origin. Route
  // authentication remains responsible for authorising those requests.
  if (!origin) {
    return true;
  }

  // A packaged file:// renderer is represented by the Fetch API as Origin:null.
  if (origin === 'null') {
    return options.desktopMode;
  }

  if (!options.developmentMode) {
    return false;
  }

  return resolveAllowedDevelopmentOrigins(options.configuredDevelopmentOrigins).has(origin);
}

export function createPatrolSafeCorsOriginValidator(options: DesktopCorsPolicyOptions) {
  return (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void): void => {
    if (isAllowedPatrolSafeOrigin(origin, options)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin is not allowed to access the PatrolSafe local service'));
  };
}
