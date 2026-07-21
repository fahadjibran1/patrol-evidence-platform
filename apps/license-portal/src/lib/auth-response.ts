import type { AdminRole, AdminUser, AuthTokensPayload, LoginResponse } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function normalizeAdmin(raw: unknown): AdminUser {
  if (!isRecord(raw)) {
    throw new Error('Login response admin profile is missing or invalid');
  }

  const id = readString(raw.id) ?? readString(raw.sub);
  const email = readString(raw.email);
  const displayName = readString(raw.displayName);
  const role = readString(raw.role) as AdminRole | null;

  if (!id || !email || !displayName || !role) {
    throw new Error('Login response admin profile is incomplete');
  }

  return {
    id,
    email,
    displayName,
    role,
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
    lastLoginAt: typeof raw.lastLoginAt === 'string' || raw.lastLoginAt === null ? raw.lastLoginAt : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
  };
}

export function normalizeAuthTokens(raw: unknown): AuthTokensPayload {
  if (!isRecord(raw)) {
    throw new Error('Login response tokens are missing or invalid');
  }

  const accessToken = readString(raw.accessToken);
  const refreshToken = readString(raw.refreshToken);
  if (!accessToken || !refreshToken) {
    throw new Error('Login response tokens are incomplete');
  }

  return {
    accessToken,
    refreshToken,
    expiresIn: readString(raw.expiresIn) ?? undefined,
  };
}

/**
 * Accept the real API shape `{ admin, tokens }` and reject unknown/malformed payloads.
 * Do not accept a flat `{ accessToken, refreshToken }` shape that does not match the API.
 */
export function parseLoginResponse(raw: unknown): {
  admin: AdminUser;
  accessToken: string;
  refreshToken: string;
  expiresIn?: string;
} {
  if (!isRecord(raw)) {
    throw new Error('Login response is not a JSON object');
  }

  const tokens = normalizeAuthTokens(raw.tokens);
  const admin = normalizeAdmin(raw.admin);

  return {
    admin,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  };
}

export function assertLoginResponseShape(raw: unknown): LoginResponse {
  if (!isRecord(raw) || !isRecord(raw.admin) || !isRecord(raw.tokens)) {
    throw new Error('Malformed login response: expected { admin, tokens }');
  }

  return raw as unknown as LoginResponse;
}

export function safeResponseKeys(raw: unknown): string[] {
  return isRecord(raw) ? Object.keys(raw).sort() : [];
}
