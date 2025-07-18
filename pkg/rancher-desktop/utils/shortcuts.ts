import os from 'os';

import { BrowserWindow } from 'electron';

import { toArray } from '@pkg/utils/array';
import Logging from '@pkg/utils/logging';

const log = Logging.shortcuts;

const Shortcut = {
  key: (shortcut: Shortcut | Electron.Input) => {
    const keyName = shortcut.key.toString();

    return [
      shortcut.meta ? 'Cmd+' : '',
      shortcut.control ? 'Ctrl+' : '',
      shortcut.shift ? 'Shift+' : '',
      shortcut.alt ? 'Alt+' : '',
      keyName.length === 1 ? keyName.toUpperCase() : keyName,
    ].join('');
  },
};

export interface Shortcut {
  platform?: NodeJS.Platform | NodeJS.Platform[];
  meta?:     boolean;
  shift?:    boolean;
  control?:  boolean;
  alt?:      boolean;
  key:       string | number;
}

interface ShortcutExt extends Shortcut {
  callback: () => void;
}

function matchPlatform(shortcut: Shortcut): boolean {
  if (shortcut.platform) {
    return toArray(shortcut.platform).includes(os.platform());
  }

  return true;
}

export const CommandOrControl = {
  meta:    os.platform() === 'darwin' ? true : undefined,
  control: os.platform() !== 'darwin' ? true : undefined,
};

class WindowShortcuts {
  private window:    BrowserWindow;
  private shortcuts: Record<string, ShortcutExt> = {};

  constructor(window: BrowserWindow) {
    this.window = window;
    this.addListener();
  }

  private inputCallback = (event: Electron.Event, input: Electron.Input) => {
    const key = Shortcut.key(input);

    if (this.shortcuts[key]) {
      this.shortcuts[key].callback();
      event.preventDefault();
    }
  };

  get shortcutsList() {
    return Object.values(this.shortcuts);
  }

  addShortcut(shortcut: ShortcutExt) {
    const key = Shortcut.key(shortcut);

    if (this.shortcuts[key]) {
      log.warn(`window [${ this.window.id }] - key [${ key }] is already registered; skip.`);

      return;
    }

    this.shortcuts[key] = shortcut;

    log.info(`add: window [${ this.window.id }] - key [${ key }]`);
  }

  removeShortcut(shortcut: Shortcut) {
    const key = Shortcut.key(shortcut);

    if (!this.shortcuts[key]) {
      log.warn(`window [${ this.window.id }] - key [${ key }] is not registered; skip.`);

      return;
    }

    delete this.shortcuts[key];

    log.info(`remove: window [${ this.window.id }] - key [${ key }]`);
  }

  addListener() {
    this.window.webContents.on('before-input-event', this.inputCallback);
  }

  removeListener() {
    this.window.webContents.off('before-input-event', this.inputCallback);
  }
}

class ShortcutsImpl {
  private windows: Record<number, WindowShortcuts> = {};

  /**
   *
   * @param window where the shortcuts takes effect, if it focused
   * @param _shortcuts definition of the shortcut, check Shortcut type
   * @param description
   * @param callback
   * @returns void
   */
  register(window: BrowserWindow, _shortcuts: Shortcut | Shortcut[], callback: () => void, description?: string) {
    const id = window?.id;
    const shortcuts = toArray(_shortcuts);

    if (id === undefined) {
      log.warn('window is undefined; skip.');

      return;
    }

    if (shortcuts.length === 0) {
      log.warn('key definition is empty; skip.');

      return;
    }

    if (description) {
      log.info(`register: window [${ id }] - [${ description }]`);
    }

    if (!this.windows[id]) {
      this.windows[id] = new WindowShortcuts(window);

      window.on('close', () => {
        delete this.windows[id];
      });
    }

    shortcuts.forEach((s) => {
      if (matchPlatform(s)) {
        this.windows[id].addShortcut({
          ...s,
          callback,
        });
      }
    });
  }

  /**
   *
   * @param window where the shortcuts is registered
   * @param _shortcuts shortcuts to be unregistered
   * @param description
   * @returns
   */
  unregister(window: BrowserWindow, _shortcuts?: Shortcut | Shortcut[], description?: string) {
    const id = window?.id;
    const shortcuts: Shortcut[] = _shortcuts ? toArray(_shortcuts) : [];

    if (id === undefined) {
      log.warn('window is undefined; skip.');

      return;
    }

    if (description) {
      log.info(`unregister: window [${ id }] - [${ description }]`);
    }

    shortcuts.forEach((s) => {
      if (matchPlatform(s)) {
        this.windows[id].removeShortcut(s);
      }
    });

    if (shortcuts.length === 0 || this.windows[id].shortcutsList.length === 0) {
      this.windows[id].removeListener();
      delete this.windows[id];

      log.info(`window [${ id }] - all keys removed`);
    }
  }

  isRegistered(window: BrowserWindow): boolean {
    const id = window?.id;

    if (id === undefined) {
      log.warn('window is undefined; skip.');

      return false;
    }

    return !!this.windows[id];
  }
}

export const Shortcuts = new ShortcutsImpl();
