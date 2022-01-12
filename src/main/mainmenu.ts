import Electron, { Menu, MenuItem, MenuItemConstructorOptions, shell } from 'electron';

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
      { role: 'selectAll', label: 'Select &All' },
    ]
  });
}

function getHelpMenu(isMac: boolean): MenuItem {
  const helpMenuItems: Array<MenuItemConstructorOptions> = [
    ...(!isMac ? [
      { role: 'about', label: `&About ${ Electron.app.name }` } as MenuItemConstructorOptions,
      { type: 'separator' } as MenuItemConstructorOptions] : []),
    {
      label: 'Get &Help',
      click() {
        shell.openExternal('https://docs.rancherdesktop.io');
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
    submenu: helpMenuItems
  });
}

function getMacApplicationMenu(): Array<MenuItem> {
  return [
    new MenuItem({
      label: Electron.app.name,
      role:  'appMenu',
    }),
    new MenuItem({
      label: 'File',
      role:  'fileMenu',
    }),
    getEditMenu(true),
    Electron.app.isPackaged ? new MenuItem({
      label:   'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ]
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
        { role: 'quit', label: 'E&xit' }
      ]
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
        { role: 'resetZoom', label: '&Actual Size' },
        { role: 'zoomIn', label: 'Zoom &In' },
        { role: 'zoomOut', label: 'Zoom &Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full &Screen' },
      ]
    }),
    getHelpMenu(false),
  ];
}
