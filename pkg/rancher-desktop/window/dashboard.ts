import path from 'path';
import { createWindow, getWindow } from '.';
import paths from '@pkg/utils/paths';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import Logging from '@pkg/utils/logging';
import mainEvents from '@pkg/main/mainEvents';

const dashboardName = 'dashboard';
const console = Logging.dashboard;
const ipcMain = getIpcMainProxy(console);

let dashboardPort = 0;

mainEvents.on('dashboard/port-changed', port => dashboardPort = port);

ipcMain.removeHandler('dashboard/get-csrf-token');
ipcMain.handle('dashboard/get-csrf-token', async (event) => {
  const webContents = event.sender;
  const url = new URL(webContents.getURL());
  const cookies = webContents.session.cookies;

  while (true) {
    const existingCookies = await cookies.get({domain: url.hostname, name: 'CSRF'});
    if (existingCookies.length > 0) {
      console.log(`Got existing cookie: ${ existingCookies[0].value }`);
      return existingCookies[0].value;
    }

    // Cookie does not exist yet; wait for a cookie with the correct name to be
    // created, then try again (to match the hostname).
    console.log('Waiting for cookie to show up');
    await new Promise<void>((resolve) => {
      function onCookieChange(_event: any, cookie: Electron.Cookie, _cause: any, removed: boolean) {
        console.log(`Cookie change: ${ cookie.name } (${ removed })`);
        if (!removed && cookie.name === 'CSRF') {
          cookies.removeListener('changed', onCookieChange);
          resolve();
        }
      }
      cookies.addListener('changed', onCookieChange);
    });
  }
});
ipcMain.removeHandler('dashboard/get-port');
ipcMain.handle('dashboard/get-port', () => dashboardPort);

export function openDashboard() {
  const dashboardURL = `https://localhost:${ dashboardPort }/dashboard/c/local/explorer`;
  const window = createWindow('dashboard', dashboardURL, {
    title: 'Rancher Dashboard',
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(paths.resources, 'preload.js'),
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => {
    window?.show();
  });
}

export function closeDashboard() {
  getWindow(dashboardName)?.close();
}
