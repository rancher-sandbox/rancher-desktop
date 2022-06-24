import { app } from 'electron';
import { getWebRoot, createWindow } from '.';

/**
 * Open the main window; if it is already open, focus it.
 */
export function openPreferences(parent: Electron.BrowserWindow) {
  const webRoot = getWebRoot();

  const window = createWindow('preferences', `${ webRoot }/index.html#preferences`, {
    parent,
    title:           'Rancher Desktop - Preferences',
    width:           940,
    height:          600,
    autoHideMenuBar: true,
    modal:           true,
    resizable:       false,
    minimizable:     false,
    show:            false,
    webPreferences:  {
      devTools:           !app.isPackaged,
      nodeIntegration:    true,
      contextIsolation:   false,
    },
  });

  window.webContents.on('ipc-message', (_event, channel) => {
    if (channel === 'preferences/load') {
      window.show();
    }
  });

  app.dock?.show();
}
