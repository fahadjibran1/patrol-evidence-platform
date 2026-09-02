/**
 * WhatsApp Web / whatsapp-web.js module compatibility detection.
 * Distinct from logout / session revocation.
 */

export const WWEBJS_MODULE_COMPATIBILITY_ERROR = 'WWEBJS_MODULE_COMPATIBILITY_ERROR' as const;

export const WWEBJS_MODULE_COMPATIBILITY_USER_MESSAGE =
  'WhatsApp connected, but this WhatsApp Web version is not compatible with the installed collector runtime.';

const UNKNOWN_MODULE_PATTERN =
  /Requiring unknown module\s+"?(WAWeb[A-Za-z0-9_]+|WAWebSocketModel)"?/i;

export interface WwebjsStoreProbeResult {
  hasWindowStore: boolean;
  hasAuthStore: boolean;
  hasChatCollection: boolean;
  hasMsgCollection: boolean;
  socketModuleId: string | null;
  socketStrategy: string | null;
  missingDependencies: string[];
  waState: string | null;
  getChatsOk: boolean | null;
  getChatsError: string | null;
  getChatsCount: number | null;
}

export function isWwebjsModuleCompatibilitySignal(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }

  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  if (normalized.includes(WWEBJS_MODULE_COMPATIBILITY_ERROR)) {
    return true;
  }

  if (UNKNOWN_MODULE_PATTERN.test(normalized)) {
    return true;
  }

  if (/CHAT_STORE_NOT_READY/i.test(normalized)) {
    return true;
  }

  return false;
}

export function extractUnknownWaWebModule(text: string): string | null {
  const match = text.match(UNKNOWN_MODULE_PATTERN);
  return match?.[1] ?? null;
}

export function shouldTreatAsModuleCompatibilityFailure(input: {
  authenticated: boolean;
  ready: boolean;
  pageSignals: string[];
  lastError?: string | null;
  chatStoreNotReady?: boolean;
  timedOutAfterAuth?: boolean;
}): boolean {
  if (input.pageSignals.some((signal) => isWwebjsModuleCompatibilitySignal(signal))) {
    return true;
  }

  if (input.lastError && isWwebjsModuleCompatibilitySignal(input.lastError)) {
    return true;
  }

  if (input.authenticated && input.chatStoreNotReady) {
    return true;
  }

  if (input.authenticated && !input.ready && input.timedOutAfterAuth) {
    return true;
  }

  return false;
}

export function buildModuleCompatibilityDetails(input: {
  missingModule?: string | null;
  probe?: Partial<WwebjsStoreProbeResult> | null;
  source?: string;
}): string {
  const parts = [
    WWEBJS_MODULE_COMPATIBILITY_ERROR,
    input.source ? `source=${input.source}` : null,
    input.missingModule ? `missingModule=${input.missingModule}` : null,
    input.probe?.missingDependencies?.length
      ? `missingDeps=${input.probe.missingDependencies.join(',')}`
      : null,
    input.probe?.socketModuleId ? `socketModule=${input.probe.socketModuleId}` : null,
    input.probe?.socketStrategy ? `socketStrategy=${input.probe.socketStrategy}` : null,
    input.probe?.hasWindowStore === false ? 'window.Store=missing' : null,
    input.probe?.hasChatCollection === false ? 'Chat=missing' : null,
    input.probe?.hasMsgCollection === false ? 'Msg=missing' : null,
    input.probe?.getChatsError ? `getChatsError=${input.probe.getChatsError}` : null,
  ].filter(Boolean);

  return parts.join(' ');
}
