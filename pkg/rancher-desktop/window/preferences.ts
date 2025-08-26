import path from 'path';

import { app, dialog } from 'electron';

import { webRoot, createWindow, getWindow } from '.';

import { Help } from '@pkg/config/help';
import paths from '@pkg/utils/paths';
import { CommandOrControl, Shortcuts } from '@pkg/utils/shortcuts';
import { getVersion } from '@pkg/utils/version';
import { preferencesNavItems } from '@pkg/window/preferenceConstants';

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
    icon:            path.join(paths.resources, 'icons', 'logo-square-512.png'),
    parent:          getWindow('main') ?? undefined,
    webPreferences:  {
      devTools:         !app.isPackaged,
      nodeIntegration:  true,
      contextIsolation: false,
    },
  });

  if (!Shortcuts.isRegistered(window)) {
    Shortcuts.register(
      window,
      [{
        key:      '?',
        meta:     true,
        platform: 'darwin',
      }, {
        key:      'F1',
        platform: ['win32', 'linux'],
      }],
      async() => {
        Help.preferences.openUrl(await getVersion());
      },
      'preferences help',
    );

    Shortcuts.register(
      window,
      { key: 'Escape' },
      () => {
        window.close();
      },
      'Close preferences dialog',
    );

    preferencesNavItems.forEach(({ name }, index) => {
      Shortcuts.register(
        window,
        {
          ...CommandOrControl,
          key: index + 1,
        },
        () => window.webContents.send('route', { name }),
        `switch preferences tabs ${ name }`,
      );
    });

    Shortcuts.register(
      window,
      {
        ...CommandOrControl,
        key: ']',
      },
      () => window.webContents.send('route', { direction: 'forward' }),
      'switch preferences tabs by cycle [forward]',
    );

    Shortcuts.register(
      window,
      {
        ...CommandOrControl,
        key: '[',
      },
      () => window.webContents.send('route', { direction: 'back' }),
      'switch preferences tabs by cycle [back]',
    );
  }

  window.webContents.on('ipc-message', (_event, channel) => {
    if (channel === 'preferences/load') {
      window.show();
    }
  });

  window.on('close', (event) => {
    if (!isDirty || (process.env.RD_TEST ?? '').includes('e2e')) {
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
