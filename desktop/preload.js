const { contextBridge, ipcRenderer } = require('electron');

const apiBaseUrlArgument = process.argv.find((value) => value.startsWith('--patrol-api-base-url='));
const apiBaseUrl = apiBaseUrlArgument?.slice('--patrol-api-base-url='.length) || 'http://localhost:3001';

contextBridge.exposeInMainWorld('desktopBridge', {
  isDesktop: true,
  apiBaseUrl,
  getApiToken: () => ipcRenderer.invoke('desktop:get-api-token'),
  beginAdminRecovery: () => ipcRenderer.invoke('desktop:begin-admin-recovery'),
  getState: () => ipcRenderer.invoke('desktop:get-state'),
  chooseStoragePath: () => ipcRenderer.invoke('desktop:choose-storage-path'),
  saveConfig: (partialConfig) => ipcRenderer.invoke('desktop:save-config', partialConfig),
  checkPostgres: (partialConfig) => ipcRenderer.invoke('desktop:postgres-check', partialConfig),
  provisionPostgres: (partialConfig) => ipcRenderer.invoke('desktop:postgres-provision', partialConfig),
  restartBackend: () => ipcRenderer.invoke('desktop:restart-backend'),
  startBackend: () => ipcRenderer.invoke('desktop:start-backend'),
  stopBackend: () => ipcRenderer.invoke('desktop:stop-backend'),
  openExternal: (targetUrl) => ipcRenderer.invoke('desktop:open-external', targetUrl),
  openPath: (targetPath) => ipcRenderer.invoke('desktop:open-path', targetPath),
  secureStoreGet: (key) => ipcRenderer.invoke('desktop:secure-store-get', key),
  secureStoreSet: (key, value) => ipcRenderer.invoke('desktop:secure-store-set', key, value),
  secureStoreClear: (key) => ipcRenderer.invoke('desktop:secure-store-clear', key),
  onBackendStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:backend-status', listener);
    return () => ipcRenderer.removeListener('desktop:backend-status', listener);
  },
});
