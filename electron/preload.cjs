// Preload bridge: safe Electron APIs exposed to the React renderer as
// window.electron. The renderer never gets full node access.
const { contextBridge, ipcRenderer } = require('electron');

// Passed by main.cjs via webPreferences.additionalArguments. Synchronous, so
// the file:// renderer knows the backend port before its first fetch.
function getArgument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const port = Number(getArgument('backend-port'));

contextBridge.exposeInMainWorld('electron', {
  backendPort: Number.isInteger(port) && port > 0 ? port : null,
  backendToken: getArgument('backend-token'),
  platform: process.platform,
  openFolder: () => ipcRenderer.invoke('dialog:open-folder'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
});
