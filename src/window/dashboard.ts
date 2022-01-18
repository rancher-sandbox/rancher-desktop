import { BrowserView, BrowserWindow } from 'electron';

const dashboardURL = 'http://127.0.0.1:9080/dashboard/c/local/explorer';

export function openDashboard() {
  const window = new BrowserWindow({ width: 800, height: 600 });

  const view = new BrowserView();
  const windowSize = window.getSize();

  window.setBrowserView(view);

  view.setBounds({
    x:      0,
    y:      0,
    width:  windowSize[0],
    height: windowSize[1],
  });

  view.setAutoResize({ width: true, height: true });

  view.webContents.loadURL(dashboardURL);
}
