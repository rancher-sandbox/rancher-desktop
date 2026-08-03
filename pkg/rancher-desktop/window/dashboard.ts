import { BrowserWindow } from 'electron';

import { windowMapping, restoreWindow } from '.';

import { Steve } from '@pkg/backend/steve';
import { onLocaleChange, t } from '@pkg/main/i18n';

const getDashboardWindow = () => ('dashboard' in windowMapping) ? BrowserWindow.fromId(windowMapping['dashboard']) : null;

export function openDashboard() {
  let window = getDashboardWindow();

  if (restoreWindow(window)) {
    return window;
  }

  const { port } = Steve.getInstance();

  if (!port) {
    return;
  }

  window = new BrowserWindow({
    title:  t('dashboard.windowTitle'),
    width:  800,
    height: 600,
    show:   false,
  });

  window.loadURL(`http://127.0.0.1:${ port }/c/local/explorer`);

  windowMapping['dashboard'] = window.id;

  const offLocaleChange = onLocaleChange(() => {
    window?.setTitle(t('dashboard.windowTitle'));
  });

  window.on('closed', offLocaleChange);

  window.once('ready-to-show', () => {
    window?.show();
  });
}

export function closeDashboard() {
  getDashboardWindow()?.close();
}
