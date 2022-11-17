import { app, dialog } from 'electron';

import { webRoot, createWindow } from '.';

import { NavItemName } from '@pkg/config/transientSettings';

interface NavItems {
  name: NavItemName;
  tabs?: string[];
}

export const preferencesNavItems: NavItems[] = [
  {
    name: 'Application',
    tabs: ['behavior', 'environment'],
  },
  { name: process.platform === 'win32' ? 'WSL' : 'Virtual Machine' },
  {
    name: 'Container Engine',
    tabs: ['general', 'allowed-images'],
  },
  { name: 'Kubernetes' },
];

let isDirty = false;

/**
 * Open the main window; if it is already open, focus it.
 */
export function openPreferences() {
  const window = createWindow('preferences', `${ webRoot }/index.html#preferences`, {
    title:           'Rancher Desktop - Preferences',
    width:           768,
    height:          512,
    autoHideMenuBar: true,
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

  window.on('close', (event) => {
    if (!isDirty) {
      return;
    }

    const cancelPosition = 1;

    const result = dialog.showMessageBoxSync(
      window,
      {
        title:    'Rancher Desktop - Close Preferences',
        type:     'warning',
        message:  'Close preferences without applying?',
        detail:   'There are preferences with changes that have not been applied. All unsaved preferences will be lost.',
        cancelId: cancelPosition,
        buttons:  [
          'Discard changes',
          'Cancel',
        ],
      });

    if (result === cancelPosition) {
      event.preventDefault();
    }
  });

  app.dock?.show();
}

export function preferencesSetDirtyFlag(dirtyFlag: boolean) {
  isDirty = dirtyFlag;
}
