const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getClaudeUsage: () => ipcRenderer.invoke('get-claude-usage'),
  getCodexUsage: () => ipcRenderer.invoke('get-codex-usage'),
  getCursorUsage: () => ipcRenderer.invoke('get-cursor-usage'),
  getAntigravityUsage: () => ipcRenderer.invoke('get-antigravity-usage'),
  resizeTo: (height) => ipcRenderer.send('resize-to', height),
  widgetDragStart: (x, y) => ipcRenderer.send('widget-drag-start', x, y),
  widgetDragStop: () => ipcRenderer.send('widget-drag-stop'),
  widgetMouseEnter: () => ipcRenderer.send('widget-mouse-enter'),
  widgetMouseLeave: () => ipcRenderer.send('widget-mouse-leave'),
});
