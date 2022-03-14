import { BrowserView, BrowserWindow } from 'electron';
import { windowMapping, didRestoreWindow } from '.';

const dashboardURL = 'http://127.0.0.1:9080/dashboard/c/local/explorer';

const getDashboardWindow = () => ('dashboard' in windowMapping) ? BrowserWindow.fromId(windowMapping['dashboard']) : null;

export function openDashboard() {
  let window = getDashboardWindow();

  if (didRestoreWindow(window)) {
    return window;
  }

  window = new BrowserWindow({
    title:  'Rancher Dashboard',
    width:  800,
    height: 600
  });

  const view = new BrowserView();
  const windowSize = window.getContentSize();

  window.setBrowserView(view);

  view.setBounds({
    x:      0,
    y:      0,
    width:  windowSize[0],
    height: windowSize[1],
  });

  view.setAutoResize({ width: true, height: true });

  view.webContents
    .loadURL(dashboardURL)
    .catch((err) => {
      console.error(`Can't load the dashboard URL ${ dashboardURL }: `, err);
    });

  windowMapping['dashboard'] = window.id;
}

export function closeDashboard() {
  getDashboardWindow()?.close();
}
