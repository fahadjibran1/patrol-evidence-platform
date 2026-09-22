import type { DesktopBackupResult, DesktopPostgresConfig, DesktopPostgresStatus, DesktopRestoreResult, DesktopState, DesktopWorkspaceConfig } from '../types';

declare global {
  interface Window {
    desktopBridge?: {
      isDesktop: boolean;
      apiBaseUrl: string | null;
      getApiBaseUrl?: () => Promise<string | null>;
      getApiToken: () => Promise<string>;
      beginAdminRecovery: () => Promise<string | null>;
      getState: () => Promise<DesktopState>;
      chooseStoragePath: () => Promise<string | null>;
      createDataBackup: () => Promise<DesktopBackupResult | null>;
      restoreDataBackup: () => Promise<DesktopRestoreResult | null>;
      saveConfig: (partialConfig: Partial<DesktopWorkspaceConfig>) => Promise<DesktopState>;
      checkPostgres: (partialConfig: DesktopPostgresConfig) => Promise<DesktopPostgresStatus>;
      provisionPostgres: (partialConfig: DesktopPostgresConfig) => Promise<DesktopPostgresStatus>;
      restartBackend: () => Promise<DesktopState>;
      startBackend: () => Promise<DesktopState>;
      stopBackend: () => Promise<DesktopState>;
      openExternal: (targetUrl: string) => Promise<boolean>;
      openCommercialPurchase: (targetUrl: string) => Promise<boolean>;
      openPath: (targetPath: string) => Promise<string>;
      onBackendStatus?: (callback: (payload: DesktopState) => void) => () => void;
      secureStoreGet?: (key: string) => Promise<string | null>;
      secureStoreSet?: (key: string, value: string) => Promise<boolean>;
      secureStoreClear?: (key: string) => Promise<boolean>;
    };
  }
}

export function isDesktopApp(): boolean {
  return window.desktopBridge?.isDesktop === true;
}

export function getDesktopApiBaseUrl(): string | null {
  return window.desktopBridge?.apiBaseUrl?.trim() ?? null;
}

export async function resolveDesktopApiBaseUrl(): Promise<string | null> {
  const dynamic = await window.desktopBridge?.getApiBaseUrl?.();
  return dynamic?.trim() || getDesktopApiBaseUrl();
}

let desktopApiTokenPromise: Promise<string | null> | null = null;

export function getDesktopApiToken(): Promise<string | null> {
  if (!window.desktopBridge?.getApiToken) {
    return Promise.resolve(null);
  }
  desktopApiTokenPromise ??= window.desktopBridge.getApiToken().then((value) => value?.trim() || null);
  return desktopApiTokenPromise;
}

export async function beginDesktopAdminRecovery(): Promise<string | null> {
  return window.desktopBridge?.beginAdminRecovery?.() ?? null;
}

export async function getDesktopState(): Promise<DesktopState | null> {
  if (!window.desktopBridge) {
    return null;
  }

  return window.desktopBridge.getState();
}

export async function chooseDesktopStoragePath(): Promise<string | null> {
  if (!window.desktopBridge) {
    return null;
  }

  return window.desktopBridge.chooseStoragePath();
}

export async function createDesktopDataBackup(): Promise<DesktopBackupResult | null> {
  return window.desktopBridge?.createDataBackup?.() ?? null;
}

export async function restoreDesktopDataBackup(): Promise<DesktopRestoreResult | null> {
  return window.desktopBridge?.restoreDataBackup?.() ?? null;
}

export async function saveDesktopConfig(partialConfig: Partial<DesktopWorkspaceConfig>): Promise<DesktopState | null> {
  if (!window.desktopBridge) {
    return null;
  }

  return window.desktopBridge.saveConfig(partialConfig);
}

export async function checkDesktopPostgres(config: DesktopPostgresConfig): Promise<DesktopPostgresStatus | null> {
  if (!window.desktopBridge) {
    return null;
  }

  return window.desktopBridge.checkPostgres(config);
}

export async function provisionDesktopPostgres(
  config: DesktopPostgresConfig,
): Promise<DesktopPostgresStatus | null> {
  if (!window.desktopBridge) {
    return null;
  }

  return window.desktopBridge.provisionPostgres(config);
}

export async function restartDesktopBackend(): Promise<DesktopState | null> {
  if (!window.desktopBridge) {
    return null;
  }

  return window.desktopBridge.restartBackend();
}

export async function openDesktopExternal(targetUrl: string): Promise<boolean> {
  if (!window.desktopBridge) {
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
    return true;
  }

  return window.desktopBridge.openExternal(targetUrl);
}

export async function openCommercialPurchase(targetUrl: string): Promise<boolean> {
  if (!window.desktopBridge?.openCommercialPurchase) return false;
  return window.desktopBridge.openCommercialPurchase(targetUrl);
}

export async function readCommercialPurchaseSession(): Promise<string | null> {
  return window.desktopBridge?.secureStoreGet?.('commercial-purchase-session') ?? null;
}

export async function writeCommercialPurchaseSession(value: string): Promise<boolean> {
  return window.desktopBridge?.secureStoreSet?.('commercial-purchase-session', value) ?? false;
}

export async function clearCommercialPurchaseSession(): Promise<boolean> {
  return window.desktopBridge?.secureStoreClear?.('commercial-purchase-session') ?? false;
}

export async function openDesktopPath(targetPath: string): Promise<string | null> {
  if (!window.desktopBridge) {
    return null;
  }

  return window.desktopBridge.openPath(targetPath);
}
