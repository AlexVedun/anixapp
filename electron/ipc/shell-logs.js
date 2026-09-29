'use strict';

const { ipcMain, shell, app } = require('electron');

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
}

module.exports = { register };
