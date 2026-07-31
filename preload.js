const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studyAPI', {
  readData: () => ipcRenderer.invoke('data:read'),
  writeData: (data) => ipcRenderer.invoke('data:write', data),
  getFilePath: () => ipcRenderer.invoke('data:filepath'),
  timerStart: () => ipcRenderer.invoke('timer:start'),
  timerStop: () => ipcRenderer.invoke('timer:stop'),
  timerStatus: () => ipcRenderer.invoke('timer:status'),
  timerResume: (mode) => ipcRenderer.invoke('timer:resume', mode),
});
