// Preload скрипт для безопасной связи между Electron и веб-контентом
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Здесь можно добавить API для связи с главным процессом, если понадобится
});



