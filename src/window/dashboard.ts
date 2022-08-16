import { BrowserWindow } from 'electron';

import { windowMapping, restoreWindow } from '.';

const dashboardURL = 'http://127.0.0.1:9080/dashboard/c/local/explorer';

const getDashboardWindow = () => ('dashboard' in windowMapping) ? BrowserWindow.fromId(windowMapping['dashboard']) : null;

export function openDashboard() {
  let window = getDashboardWindow();

  if (restoreWindow(window)) {
    return window;
  }

  window = new BrowserWindow({
    title:  'Rancher Dashboard',
    width:  800,
    height: 600,
    show:   false,
  });

  window.loadURL(dashboardURL);

  windowMapping['dashboard'] = window.id;

  window.once('ready-to-show', () => {
    window?.show();
  });
}

export function closeDashboard() {
  getDashboardWindow()?.close();
}
