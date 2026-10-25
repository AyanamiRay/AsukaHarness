const { contextBridge, ipcRenderer } = require('electron');

/**
 * Narrow bridge for the skin picker window only.
 *
 * The DSH page itself gets no preload and no bridge: everything it needs is
 * ordinary web API surface.
 */
contextBridge.exposeInMainWorld('dshShell', {
  list: () => ipcRenderer.invoke('skins:list'),
  apply: (id) => ipcRenderer.invoke('skins:apply', id),
  setEnabled: (value) => ipcRenderer.invoke('skins:set-enabled', value),
  setTransparentRoot: (value) => ipcRenderer.invoke('skins:set-transparent-root', value),
  importImage: () => ipcRenderer.invoke('skins:import'),
  openFolder: () => ipcRenderer.invoke('skins:open-folder'),
  reload: () => ipcRenderer.invoke('skins:reload'),
  close: () => ipcRenderer.invoke('skins:close'),
  locale: () => ipcRenderer.invoke('shell:locale'),
});
