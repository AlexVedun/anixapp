'use strict';

const { ipcMain, BrowserWindow } = require('electron');
const { shell, app } = require('electron');
const diagnostics = require('../session-diagnostics');

function register() {
  ipcMain.handle('shell:openExternal', (_, url) => {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      return shell.openExternal(parsed.href);
    } catch {
      return false;
    }
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());

  ipcMain.handle('app:getVersions', () => {
    let anixapiVersion = '';
    try {
      const pkg = require('anixapi/package.json');
      anixapiVersion = pkg.version || '';
    } catch (_) {}
    return {
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      anixapi: anixapiVersion,
      anixartjs: anixapiVersion,
    };
  });

  ipcMain.handle('diagnostics:get', (_, opts) => diagnostics.getEntries(opts || {}));
  ipcMain.handle('diagnostics:stats', () => diagnostics.stats());
  ipcMain.handle('diagnostics:clear', () => diagnostics.clear());

  ipcMain.handle('diagnostics:subscribe', (event) => {
    const id = event.sender?.id;
    return diagnostics.subscribe(id);
  });

  ipcMain.handle('diagnostics:unsubscribe', (event) => {
    const id = event.sender?.id;
    return diagnostics.unsubscribe(id);
  });

  ipcMain.handle('diagnostics:exportZip', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return diagnostics.exportZipWithDialog(win && !win.isDestroyed() ? win : null);
  });

  ipcMain.handle('diagnostics:reveal', async (_, filePath) => {
    if (filePath) shell.showItemInFolder(filePath);
    return { ok: true };
  });
}

module.exports = { register };
