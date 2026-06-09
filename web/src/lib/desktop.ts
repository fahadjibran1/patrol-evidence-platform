import type { DesktopPostgresConfig, DesktopPostgresStatus, DesktopState, DesktopWorkspaceConfig } from '../types';

declare global {
  interface Window {
    desktopBridge?: {
      isDesktop: boolean;
      apiBaseUrl: string;
      getState: () => Promise<DesktopState>;
      chooseStoragePath: () => Promise<string | null>;
      saveConfig: (partialConfig: Partial<DesktopWorkspaceConfig>) => Promise<DesktopState>;
      checkPostgres: (partialConfig: DesktopPostgresConfig) => Promise<DesktopPostgresStatus>;
      provisionPostgres: (partialConfig: DesktopPostgresConfig) => Promise<DesktopPostgresStatus>;
      restartBackend: () => Promise<DesktopState>;
      startBackend: () => Promise<DesktopState>;
      stopBackend: () => Promise<DesktopState>;
      openExternal: (targetUrl: string) => Promise<boolean>;
      openPath: (targetPath: string) => Promise<string>;
      onBackendStatus?: (callback: (payload: DesktopState) => void) => () => void;
    };
  }
}

export function isDesktopApp(): boolean {
  return window.desktopBridge?.isDesktop === true;
}

export function getDesktopApiBaseUrl(): string | null {
  return window.desktopBridge?.apiBaseUrl?.trim() ?? null;
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

export async function openDesktopPath(targetPath: string): Promise<string | null> {
  if (!window.desktopBridge) {
    return null;
  }

  return window.desktopBridge.openPath(targetPath);
}
