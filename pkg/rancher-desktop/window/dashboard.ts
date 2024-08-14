import path from 'path';
import { createWindow, getWindow } from '.';
import paths from '@pkg/utils/paths';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import Logging from '@pkg/utils/logging';

const dashboardName = 'dashboard';
const dashboardURL = 'https://localhost/dashboard/c/local/explorer';
const console = Logging.dashboard;
const ipcMain = getIpcMainProxy(console);

ipcMain.removeHandler('dashboard/get-csrf-token');
ipcMain.handle('dashboard/get-csrf-token', async (event) => {
  const webContents = event.sender;
  const cookies = await webContents.session.cookies.get({
    url: webContents.getURL(),
    name: 'CSRF',
  });
  return cookies?.[0].value ?? null;
})

export function openDashboard() {
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
