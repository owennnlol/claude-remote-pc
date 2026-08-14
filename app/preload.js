const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  checkGh: () => ipcRenderer.invoke('check-gh'),
  startSession: (repo) => ipcRenderer.invoke('start-session', { repo }),
  sendPrompt: (controlUrl, controlToken, task) =>
    ipcRenderer.invoke('send-prompt', { controlUrl, controlToken, task }),
  stopSession: (controlUrl, controlToken) =>
    ipcRenderer.invoke('stop-session', { controlUrl, controlToken }),
});
