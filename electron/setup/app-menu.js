'use strict';

const { Menu, app } = require('electron');
const state = require('../lib/app-state');
const { createMainWindow } = require('./main-window');

// app.name в dev берётся из package.json («anixapp»), поэтому название задано явно.
const APP_NAME = 'AnixApp';

/**
 * Меню приложения для macOS. На Windows и Linux окна без рамки и меню не показывают,
 * поэтому там остаётся стандартное поведение Electron.
 */
function setupAppMenu(deps) {
  if (process.platform !== 'darwin') return;

  const openSettings = () => {
    // Окно может быть закрыто при живом приложении — создаём заново и открываем настройки после загрузки.
    if (!state.mainWindow) {
      createMainWindow(deps);
      const win = state.mainWindow;
      win?.webContents.once('did-finish-load', () => {
        if (!win.isDestroyed()) win.webContents.send('app:openSettings');
      });
      return;
    }
    state.mainWindow.show();
    state.mainWindow.focus();
    state.mainWindow.webContents.send('app:openSettings');
  };

  const viewSubmenu = [
    { role: 'togglefullscreen', label: 'Полноэкранный режим' },
  ];
  if (!app.isPackaged) {
    viewSubmenu.push(
      { type: 'separator' },
      { role: 'reload', label: 'Перезагрузить' },
      { role: 'forceReload', label: 'Перезагрузить без кэша' },
      { role: 'toggleDevTools', label: 'Инструменты разработчика' },
    );
  }

  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `О программе ${APP_NAME}` },
        { type: 'separator' },
        { label: 'Настройки…', accelerator: 'Command+,', click: openSettings },
        { type: 'separator' },
        { role: 'services', label: 'Службы' },
        { type: 'separator' },
        { role: 'hide', label: `Скрыть ${APP_NAME}` },
        { role: 'hideOthers', label: 'Скрыть остальные' },
        { role: 'unhide', label: 'Показать все' },
        { type: 'separator' },
        { role: 'quit', label: `Завершить ${APP_NAME}` },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Скопировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'pasteAndMatchStyle', label: 'Вставить и согласовать стиль' },
        { role: 'delete', label: 'Удалить' },
        { role: 'selectAll', label: 'Выбрать все' },
      ],
    },
    { label: 'Вид', submenu: viewSubmenu },
    {
      label: 'Окно',
      role: 'window',
      submenu: [
        { role: 'minimize', label: 'Убрать в Dock' },
        { role: 'zoom', label: 'Изменить масштаб' },
        { role: 'close', label: 'Закрыть окно' },
        { type: 'separator' },
        { role: 'front', label: 'Все окна — на передний план' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { setupAppMenu };
