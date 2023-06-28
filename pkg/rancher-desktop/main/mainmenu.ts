import Electron, { Menu, MenuItem, MenuItemConstructorOptions, shell } from 'electron';

import { getVersion, parseDocsVersion } from '@pkg/utils/version';
import { openPreferences } from '@pkg/window/preferences';

const baseUrl = `https://docs.rancherdesktop.io`;

async function versionedDocsUrl() {
  const version = await getVersion();
  const parsed = parseDocsVersion(version);

  return `${ baseUrl }/${ parsed }`;
}

export default function buildApplicationMenu(): void {
  const menuItems: Array<MenuItem> = getApplicationMenu();
  const menu = Menu.buildFromTemplate(menuItems);

  Menu.setApplicationMenu(menu);
}

function getApplicationMenu(): Array<MenuItem> {
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
    label:   '&Edit',
    submenu: [
      { role: 'undo', label: '&Undo' },
      { role: 'redo', label: '&Redo' },
      { type: 'separator' },
      { role: 'cut', label: 'Cu&t' },
      { role: 'copy', label: '&Copy' },
      { role: 'paste', label: '&Paste' },
      { role: 'delete', label: 'De&lete' },
      ...(!isMac ? [{ type: 'separator' } as MenuItemConstructorOptions] : []),
      { role: 'selecctAll', label: 'Select &All' },
    ],
  });
}

function getHelpMenu(isMac: boolean): MenuItem {
  const helpMenuItems: Array<MenuItemConstructorOptions> = [
    ...(!isMac ? [
      {
        role:  'about',
        label: `&About ${ Electron.app.name }`,
        click() {
          Electron.app.showAboutPanel();
        },
      } as MenuItemConstructorOptions,
      { type: 'separator' } as MenuItemConstructorOptions,
    ] : []),
    {
      label: isMac ? 'Rancher Desktop &Help' : 'Get &Help',
      click: async() => {
        shell.openExternal(await versionedDocsUrl());
      },
    },
    {
      label: 'File a &Bug',
      click() {
        shell.openExternal('https://github.com/rancher-sandbox/rancher-desktop/issues');
      },
    },
    {
      label: '&Project Page',
      click() {
        shell.openExternal('https://rancherdesktop.io/');
      },
    },
    {
      label: '&Discuss',
      click() {
        shell.openExternal('https://slack.rancher.io/');
      },
    },
  ];

  return new MenuItem({
    role:    'help',
    label:   '&Help',
    submenu: helpMenuItems,
  });
}

function getMacApplicationMenu(): Array<MenuItem> {
  return [
    new MenuItem({
      label:   Electron.app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        ...getPreferencesMenuItem(),
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }),
    new MenuItem({
      label: 'File',
      role:  'fileMenu',
    }),
    getEditMenu(true),
    Electron.app.isPackaged ? new MenuItem({
      label:   'View',
      submenu: [
        {
          label:       'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click(_item, focusedWindow) {
            setZoomLevel(focusedWindow, 0, '0');
          },
        },
        {
          label:       'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click(_item, focusedWindow) {
            setZoomLevel(focusedWindow, 0.5, 'Plus');
          },
        },
        {
          label:       'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click(_item, focusedWindow) {
            setZoomLevel(focusedWindow, -0.5, '-');
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    }) : new MenuItem({
      label: 'View',
      role:  'viewMenu',
    }),
    new MenuItem({
      label: '&Window',
      role:  'windowMenu',
    }),
    getHelpMenu(true),
  ];
}

function getWindowsApplicationMenu(): Array<MenuItem> {
  return [
    new MenuItem({
      label:   '&File',
      role:    'fileMenu',
      submenu: [
        ...getPreferencesMenuItem(),
        {
          role:  'quit',
          label: 'E&xit',
        },
      ],
    }),
    getEditMenu(false),
    new MenuItem({
      label:   '&View',
      role:    'viewMenu',
      submenu: [
        ...(Electron.app.isPackaged ? [] : [
          { role: 'reload', label: '&Reload' },
          { role: 'forceReload', label: '&Force Reload' },
          { role: 'toggleDevTools', label: 'Toggle &Developer Tools' },
          { type: 'separator' },
        ] as MenuItemConstructorOptions[]),
        {
          label:       '&Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click(_item, focusedWindow) {
            setZoomLevel(focusedWindow, 0, '0');
          },
        },
        {
          label:       'Zoom &In',
          accelerator: 'CmdOrCtrl+Plus',
          click(_item, focusedWindow) {
            setZoomLevel(focusedWindow, 0.5, 'Plus');
          },
        },
        {
          accelerator: 'CmdOrCtrl+-',
          label:       'Zoom &Out',
          click(_item, focusedWindow) {
            setZoomLevel(focusedWindow, -0.5, '-');
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full &Screen' },
      ],
    }),
    getHelpMenu(false),
  ];
}

/**
 * Gets the preferences menu item for all supported platforms
 * @returns MenuItemConstructorOptions: The preferences menu item object
 */
function getPreferencesMenuItem(): MenuItemConstructorOptions[] {
  return [
    {
      label:               'Preferences',
      visible:             true,
      registerAccelerator: false,
      accelerator:         'CmdOrCtrl+,',
      click:               openPreferences,
    },
    { type: 'separator' },
  ];
}

/**
 * Adjusts the zoom level for the focused window by the desired increment. Also
 * adjusts the zoom level for an attached browser view if one exists.
 * @param focusedWindow The window that has focus
 * @param zoomLevelAdjustment The desired increment to adjust the zoom level by
 * @param keyEventKeyCode The key code associated with the zoom level adjustment
 */
function setZoomLevel(focusedWindow: Electron.BrowserWindow | undefined, zoomLevelAdjustment: number, keyEventKeyCode: string) {
  if (!focusedWindow) {
    return;
  }

  const { webContents } = focusedWindow;
  const currentZoomLevel = webContents.getZoomLevel();
  const view = focusedWindow.getBrowserView();

  if (!view) {
    const desiredZoomLevel = zoomLevelAdjustment === 0 ? zoomLevelAdjustment : currentZoomLevel + zoomLevelAdjustment;

    webContents.setZoomLevel(desiredZoomLevel);
    focusedWindow.getBrowserView()?.webContents.setZoomLevel(desiredZoomLevel);

    return;
  }

  const event: Electron.KeyboardInputEvent = {
    type:      'keyDown',
    keyCode:   keyEventKeyCode,
    modifiers: ['ctrl', 'control'],
  };

  webContents.sendInputEvent(event);
}
