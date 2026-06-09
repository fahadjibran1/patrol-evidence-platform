const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  isDesktop: true,
  apiBaseUrl: 'http://localhost:3001',
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
  onBackendStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:backend-status', listener);
    return () => ipcRenderer.removeListener('desktop:backend-status', listener);
  },
});
