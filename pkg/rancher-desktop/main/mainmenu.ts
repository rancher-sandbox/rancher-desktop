import Electron, { Menu, MenuItem, MenuItemConstructorOptions, shell } from 'electron';

import { Help } from '@pkg/config/help';
import { onLocaleChange, t } from '@pkg/main/i18n';
import { openPreferences } from '@pkg/window/preferences';

export default function buildApplicationMenu(): void {
  const menuItems: MenuItem[] = getApplicationMenu();
  const menu = Menu.buildFromTemplate(menuItems);

  Menu.setApplicationMenu(menu);
}

// Menu labels are translated when the menu is built, so rebuild on locale change.
onLocaleChange(() => buildApplicationMenu());

function getApplicationMenu(): MenuItem[] {
  switch (process.platform) {
  case 'darwin':
    return getMacApplicationMenu();
  case 'linux':
    return getWindowsApplicationMenu();
  case 'win32':
    return getWindowsApplicationMenu();
  default:
    throw new Error(`Unsupported platform: ${ process.platform }`);
  }
}

function getEditMenu(isMac: boolean): MenuItem {
  return new MenuItem({
    label:   t('mainMenu.edit.label'),
    submenu: [
      { role: 'undo', label: t('mainMenu.edit.undo') },
      { role: 'redo', label: t('mainMenu.edit.redo') },
      { type: 'separator' },
      { role: 'cut', label: t('mainMenu.edit.cut') },
      { role: 'copy', label: t('mainMenu.edit.copy') },
      { role: 'paste', label: t('mainMenu.edit.paste') },
      { role: 'delete', label: t('mainMenu.edit.delete') },
      ...(!isMac ? [{ type: 'separator' } as MenuItemConstructorOptions] : []),
      { role: 'selectAll', label: t('mainMenu.edit.selectAll') },
    ],
  });
}

function getViewMenu(): MenuItem {
  return new MenuItem({
    label:   t('mainMenu.view.label'),
    submenu: [
      ...(Electron.app.isPackaged
        ? []
        : [
          { role: 'reload', label: t('mainMenu.view.reload') },
          { role: 'forceReload', label: t('mainMenu.view.forceReload') },
          { role: 'toggleDevTools', label: t('mainMenu.view.toggleDevTools') },
          { type: 'separator' },
        ] as const),
      {
        label:       t('mainMenu.view.actualSize'),
        accelerator: 'CmdOrCtrl+0',
        click(_item, focusedWindow) {
          adjustZoomLevel(focusedWindow, 0);
        },
      },
      {
        label:       t('mainMenu.view.zoomIn'),
        accelerator: 'CmdOrCtrl+Plus',
        click(_item, focusedWindow) {
          adjustZoomLevel(focusedWindow, 0.5);
        },
      },
      {
        label:       t('mainMenu.view.zoomOut'),
        accelerator: 'CmdOrCtrl+-',
        click(_item, focusedWindow) {
          adjustZoomLevel(focusedWindow, -0.5);
        },
      },
      { type: 'separator' },
      { role: 'togglefullscreen', label: t('mainMenu.view.toggleFullScreen') },
    ],
  });
}

function getHelpMenu(isMac: boolean): MenuItem {
  const appName = Electron.app.name;
  const helpMenuItems: MenuItemConstructorOptions[] = [
    ...(!isMac
      ? [
        {
          role:  'about',
          label: t('mainMenu.help.about', { appName }),
          click() {
            Electron.app.showAboutPanel();
          },
        } as MenuItemConstructorOptions,
        { type: 'separator' } as MenuItemConstructorOptions,
      ]
      : []),
    {
      label: isMac ? t('mainMenu.help.help', { appName }) : t('mainMenu.help.getHelp'),
      click() {
        Help.openUrl();
      },
    },
    {
      label: t('mainMenu.help.fileABug'),
      click() {
        shell.openExternal('https://github.com/rancher-sandbox/rancher-desktop/issues');
      },
    },
    {
      label: t('mainMenu.help.projectPage'),
      click() {
        shell.openExternal('https://rancherdesktop.io/');
      },
    },
    {
      label: t('mainMenu.help.discuss'),
      click() {
        shell.openExternal('https://slack.rancher.io/');
      },
    },
  ];

  return new MenuItem({
    role:    'help',
    label:   t('mainMenu.help.label'),
    submenu: helpMenuItems,
  });
}

function getMacApplicationMenu(): MenuItem[] {
  const appName = Electron.app.name;

  return [
    new MenuItem({
      label:   appName,
      submenu: [
        { role: 'about', label: t('mainMenu.about', { appName }) },
        { type: 'separator' },
        ...getPreferencesMenuItem(),
        { role: 'services', label: t('mainMenu.services') },
        { type: 'separator' },
        { role: 'hide', label: t('mainMenu.hide', { appName }) },
        { role: 'hideOthers', label: t('mainMenu.hideOthers') },
        { role: 'unhide', label: t('mainMenu.showAll') },
        { type: 'separator' },
        { role: 'quit', label: t('mainMenu.quit', { appName }) },
      ],
    }),
    new MenuItem({
      label:   t('mainMenu.file.label'),
      submenu: [
        { role: 'close', label: t('mainMenu.file.close') },
      ],
    }),
    getEditMenu(true),
    getViewMenu(),
    new MenuItem({
      role:    'windowMenu',
      label:   t('mainMenu.window.label'),
      submenu: [
        { role: 'minimize', label: t('mainMenu.window.minimize') },
        { role: 'zoom', label: t('mainMenu.window.zoom') },
        { type: 'separator' },
        { role: 'front', label: t('mainMenu.window.front') },
      ],
    }),
    getHelpMenu(true),
  ];
}

function getWindowsApplicationMenu(): MenuItem[] {
  return [
    new MenuItem({
      label:   t('mainMenu.file.label'),
      role:    'fileMenu',
      submenu: [
        ...getPreferencesMenuItem(),
        {
          role:  'quit',
          label: t('mainMenu.file.exit'),
        },
      ],
    }),
    getEditMenu(false),
    getViewMenu(),
    getHelpMenu(false),
  ];
}

/**
 * Gets the preferences menu item for all supported platforms.
 */
function getPreferencesMenuItem(): MenuItemConstructorOptions[] {
  return [
    {
      label:               t('mainMenu.preferences'),
      visible:             true,
      registerAccelerator: false,
      accelerator:         'CmdOrCtrl+,',
      click:               openPreferences,
    },
    { type: 'separator' },
  ];
}

/**
 * Adjusts the zoom level for the focused window by the desired increment.
 * Also emits an IPC request to the webContents to trigger a resize of the
 * extensions view.
 * @param focusedWindow The window that has focus
 * @param zoomLevelAdjustment The desired increment to adjust the zoom level by
 */
function adjustZoomLevel(focusedWindow: Electron.BaseWindow | undefined, zoomLevelAdjustment: number) {
  if (!focusedWindow || !(focusedWindow instanceof Electron.BrowserWindow)) {
    return;
  }

  const { webContents } = focusedWindow;
  const currentZoomLevel = webContents.getZoomLevel();
  const desiredZoomLevel = zoomLevelAdjustment === 0 ? zoomLevelAdjustment : currentZoomLevel + zoomLevelAdjustment;

  webContents.setZoomLevel(desiredZoomLevel);

  // Also sync the zoom level of any child views (e.g. the extensions view in
  // the main window).
  for (const child of focusedWindow.contentView.children) {
    if (child instanceof Electron.WebContentsView) {
      child.webContents.setZoomLevel(desiredZoomLevel);
    }
  }
  // For the main window, this triggers resizing the extensions view.
  setImmediate(() => webContents.send('extensions/getContentArea'));
}
