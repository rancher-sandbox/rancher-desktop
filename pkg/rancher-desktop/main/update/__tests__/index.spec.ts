import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { jest } from '@jest/globals';

import mockModules from '@pkg/utils/testUtils/mockModules';

import type { LonghornUpdateInfo } from '../LonghornProvider';
import type { UpdateState } from '../index';

/**
 * A stand-in for electron-updater's platform updater. setupUpdate() attaches all
 * of its event handlers to this object; each test then emits the same events that
 * electron-updater would, to drive the update state machine directly.
 */
const updaterInstances: FakeUpdater[] = [];

class FakeUpdater extends EventEmitter {
  logger: unknown;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  forceDevUpdateConfig = false;

  constructor(public options?: unknown) {
    super();
    updaterInstances.push(this);
  }

  isUpdaterActive(): boolean {
    return true;
  }

  checkForUpdates = jest.fn<() => Promise<{ updateInfo: { nextUpdateTime: number } } | null>>()
    .mockResolvedValue({ updateInfo: { nextUpdateTime: Date.now() + 100_000 } });

  quitAndInstall = jest.fn();
}

const appUpdateConfigPath = path.join(os.tmpdir(), 'rd-update-state-machine-test.yaml');

class FakeElectronAppAdapter {
  get appUpdateConfigPath(): string {
    return appUpdateConfigPath;
  }
}

const sentStates: UpdateState[] = [];
const send = jest.fn((channel: string, state: UpdateState) => {
  if (channel === 'update-state') {
    sentStates.push({ ...state });
  }
});
const setHasQueuedUpdate = jest.fn<(isQueued: boolean) => Promise<void>>();
const hasQueuedUpdate = jest.fn<() => Promise<boolean>>().mockResolvedValue(false);
const logStub = {
  log: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn(), debugE: jest.fn(),
};

/** The IPC handlers the update module registers, by channel. */
const ipcMainHandlers: Record<string, () => void> = {};

mockModules({
  electron:                                  {
    ipcMain: {
      on: jest.fn((channel: string, handler: () => void) => {
        ipcMainHandlers[channel] = handler;
      }),
    },
  },
  'electron-updater/out/MacUpdater':         { MacUpdater: FakeUpdater },
  'electron-updater/out/AppImageUpdater':    { AppImageUpdater: FakeUpdater },
  'electron-updater/out/ElectronAppAdapter': { ElectronAppAdapter: FakeElectronAppAdapter },
  '@pkg/main/update/MSIUpdater':             { default: FakeUpdater },
  '@pkg/main/update/LonghornProvider':       { default: class {}, hasQueuedUpdate, setHasQueuedUpdate },
  '@pkg/window':                             { send },
  '@pkg/main/mainEvents':                    { on: jest.fn() },
  '@pkg/utils/logging':                      { default: new Proxy({}, { get: () => logStub }) },
  // Bridge the timers module to the global setTimeout/clearTimeout so jest's
  // fake timers (which only patch the globals) control the update scheduler.
  timers:                                    {
    setTimeout:   (callback: () => void, ms?: number) => setTimeout(callback, ms),
    clearTimeout: (handle?: NodeJS.Timeout) => clearTimeout(handle),
  },
});

function makeInfo(version: string): LonghornUpdateInfo {
  return {
    version,
    files:                      [],
    path:                       '',
    sha512:                     '',
    releaseDate:                '',
    nextUpdateTime:             Date.now() + 100_000,
    unsupportedUpdateAvailable: false,
  };
}

function lastState(): UpdateState {
  return sentStates[sentStates.length - 1];
}

/** Let detached promises (checkForUpdates, the install path) settle. */
function flush(): Promise<void> {
  return jest.advanceTimersByTimeAsync(0);
}

describe('setupUpdate state machine', () => {
  let setupUpdate: typeof import('../index').default;
  let updater: FakeUpdater;

  beforeAll(async() => {
    jest.useFakeTimers();
    fs.writeFileSync(appUpdateConfigPath, '{}');
    ({ default: setupUpdate } = await import('../index'));

    await setupUpdate(true);
    await flush();
    updater = updaterInstances[updaterInstances.length - 1];
  });

  afterAll(() => {
    jest.useRealTimers();
    fs.rmSync(appUpdateConfigPath, { force: true });
  });

  beforeEach(() => {
    // Reset to a clean slate: install latch released, error cleared, no staged
    // version, updater re-armed. The error clears the install latch a prior
    // test may have left set; checking-for-update then clears the error.
    updater.emit('error', new Error('reset'));
    updater.emit('checking-for-update');
    updater.emit('update-not-available', makeInfo('v0.0.0'));
    updater.autoDownload = true;
    sentStates.length = 0;
    updater.checkForUpdates.mockClear();
    updater.quitAndInstall.mockClear();
    hasQueuedUpdate.mockClear();
    setHasQueuedUpdate.mockClear();
    jest.clearAllTimers();
  });

  it('keeps the staged update installable when a re-check finds the same version', () => {
    const info = makeInfo('v1.22.3');

    // First check after a restart: the update is already in the pending cache,
    // so electron-updater skips the download and emits update-downloaded with no
    // preceding download-progress event.
    updater.emit('checking-for-update');
    updater.emit('update-available', info);
    updater.emit('update-downloaded', info);

    expect(lastState()).toMatchObject({ available: true, downloaded: true });
    expect(updater.autoDownload).toBe(false);

    // A later scheduled check finds the same version still available. The
    // restart button must remain, and the updater must keep the staged
    // download instead of fetching it again.
    updater.emit('checking-for-update');
    updater.emit('update-available', info);

    expect(lastState()).toMatchObject({ available: true, downloaded: true });
    expect(updater.autoDownload).toBe(false);
  });

  it('discards the staged update and downloads a newer version when one appears', () => {
    const older = makeInfo('v1.22.2');
    const newer = makeInfo('v1.22.3');

    updater.emit('checking-for-update');
    updater.emit('update-available', older);
    updater.emit('update-downloaded', older);

    expect(lastState()).toMatchObject({ downloaded: true, info: expect.objectContaining({ version: 'v1.22.2' }) });
    expect(updater.autoDownload).toBe(false);

    // A newer version shows up. We must stop offering the stale download and
    // re-arm autoDownload so the updater fetches the new one.
    updater.emit('checking-for-update');
    updater.emit('update-available', newer);

    expect(updater.autoDownload).toBe(true);
    expect(lastState()).toMatchObject({ downloaded: false, info: expect.objectContaining({ version: 'v1.22.3' }) });

    // The newer download completes.
    updater.emit('download-progress', {
      total: 2, delta: 1, transferred: 1, percent: 50, bytesPerSecond: 1000,
    });
    updater.emit('update-downloaded', newer);

    expect(lastState()).toMatchObject({ downloaded: true, info: expect.objectContaining({ version: 'v1.22.3' }) });
    expect(updater.autoDownload).toBe(false);
  });

  it('forwards download progress to the renderer', () => {
    const progress = {
      total: 4, delta: 2, transferred: 2, percent: 50, bytesPerSecond: 2048,
    };

    updater.emit('checking-for-update');
    updater.emit('update-available', makeInfo('v1.22.3'));
    updater.emit('download-progress', progress);

    expect(lastState()).toMatchObject({ available: true, downloaded: false, progress });
  });

  it('clears stale download progress when a new check starts', () => {
    updater.emit('checking-for-update');
    updater.emit('update-available', makeInfo('v1.22.3'));
    updater.emit('download-progress', {
      total: 4, delta: 2, transferred: 2, percent: 50, bytesPerSecond: 2048,
    });

    expect(lastState().progress).toBeDefined();

    updater.emit('checking-for-update');
    updater.emit('update-available', makeInfo('v1.22.4'));

    expect(lastState().progress).toBeUndefined();
  });

  it('reports an updater error but keeps a staged update installable', () => {
    const info = makeInfo('v1.22.3');

    updater.emit('checking-for-update');
    updater.emit('update-available', info);
    updater.emit('update-downloaded', info);

    expect(lastState().downloaded).toBe(true);

    const error = new Error('the network is down');

    updater.emit('error', error);

    // The update is on disk, so it can still be installed; only the failure of
    // whatever ran next is news.
    expect(lastState().downloaded).toBe(true);
    expect(lastState().error).toBe(error);
  });

  it('keeps a staged update on offer when a later check fails', () => {
    const info = makeInfo('v1.22.3');

    updater.emit('checking-for-update');
    updater.emit('update-available', info);
    updater.emit('update-downloaded', info);
    setHasQueuedUpdate.mockClear();

    // The check never got far enough to retract the offer, so the update the
    // previous one found is still installable.
    updater.emit('checking-for-update');
    updater.emit('error', new Error('the network is down'));

    // Without `available` the renderer hides the whole card, taking the
    // Restart Now button with it.
    expect(lastState()).toMatchObject({ available: true, downloaded: true });
    // The on-disk flag decides whether the next launch installs or re-downloads.
    expect(setHasQueuedUpdate).toHaveBeenLastCalledWith(true);
  });

  it('reports a failed download as not downloaded', () => {
    updater.emit('checking-for-update');
    updater.emit('update-available', makeInfo('v1.22.3'));
    updater.emit('download-progress', {
      total: 4, delta: 2, transferred: 2, percent: 50, bytesPerSecond: 2048,
    });

    const error = new Error('download failed');

    updater.emit('error', error);

    expect(lastState()).toMatchObject({ available: true, downloaded: false, error });
  });

  it('keeps checking after a failed download', async() => {
    // A real check arms the timer for the next one, then starts the download.
    await setupUpdate(true);
    await flush();
    updater.checkForUpdates.mockClear();

    updater.emit('checking-for-update');
    updater.emit('update-available', makeInfo('v1.22.3'));
    updater.emit('download-progress', {
      total: 4, delta: 2, transferred: 2, percent: 50, bytesPerSecond: 2048,
    });
    updater.emit('error', new Error('download failed'));

    // A failed download must not wedge the state machine: the scheduled check
    // has to keep running so the download gets another chance.
    await jest.runOnlyPendingTimersAsync();

    expect(updater.checkForUpdates).toHaveBeenCalled();
  });

  it('clears a previous error once a later check succeeds', () => {
    const error = new Error('boom');

    updater.emit('error', error);

    expect(lastState().error).toBe(error);

    updater.emit('checking-for-update');
    updater.emit('update-available', makeInfo('v1.22.3'));

    expect(lastState().error).toBeUndefined();
  });

  it('installs a queued update at launch instead of checking for a new one', async() => {
    hasQueuedUpdate.mockResolvedValueOnce(true);

    const installing = setupUpdate(true, true);

    // The install path waits for update-downloaded before quitting to install.
    await flush();
    updater.emit('update-downloaded', makeInfo('v1.22.3'));

    await expect(installing).resolves.toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('continues startup instead of hanging when the queued-install check fails', async() => {
    hasQueuedUpdate.mockResolvedValueOnce(true);
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));

    await expect(setupUpdate(true, true)).resolves.toBe(false);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    // The failed install must still schedule the periodic checks.
    await flush();
    expect(jest.getTimerCount()).toBeGreaterThan(0);
  });

  it('continues startup when the queued update is no longer offered', async() => {
    hasQueuedUpdate.mockResolvedValueOnce(true);

    const installing = setupUpdate(true, true);

    await flush();
    updater.emit('update-not-available', makeInfo('v1.22.3'));

    await expect(installing).resolves.toBe(false);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('continues startup when update checks are disabled during the queued install', async() => {
    hasQueuedUpdate.mockResolvedValueOnce(true);
    // A falsy check result means updates are disabled: no events fire, so the
    // install path must settle on the result alone rather than wait forever.
    updater.checkForUpdates.mockResolvedValueOnce(null);

    await expect(setupUpdate(true, true)).resolves.toBe(false);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    // Falling through still schedules the periodic checks.
    await flush();
    expect(jest.getTimerCount()).toBeGreaterThan(0);
  });

  it('does not install on a later download once the queued install has settled', async() => {
    hasQueuedUpdate.mockResolvedValueOnce(true);

    const installing = setupUpdate(true, true);

    await flush();
    updater.emit('update-not-available', makeInfo('v1.22.3'));

    await expect(installing).resolves.toBe(false);

    // The install path removed its one-shot listeners on the way out, so a
    // later periodic check's download must not fire a stale quitAndInstall.
    updater.emit('update-downloaded', makeInfo('v1.22.4'));

    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('hands the update to only one installer at a time', () => {
    const info = makeInfo('v1.22.3');

    updater.emit('checking-for-update');
    updater.emit('update-available', info);
    updater.emit('update-downloaded', info);

    ipcMainHandlers['update-apply']();
    ipcMainHandlers['update-apply']();

    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);

    // Installing failed and left the application running, so asking again has
    // to reach the installer.
    updater.emit('error', new Error('install failed'));
    ipcMainHandlers['update-apply']();

    expect(updater.quitAndInstall).toHaveBeenCalledTimes(2);
  });

  it('keeps the install latched when an in-flight check fails', async() => {
    await setupUpdate(true);
    await flush();

    const info = makeInfo('v1.22.3');

    updater.emit('checking-for-update');
    updater.emit('update-available', info);
    updater.emit('update-downloaded', info);

    // A scheduled check is already in flight when the user installs. When that
    // check later fails it must not release the latch and re-enable the button
    // the install already claimed. electron-updater emits 'error' for a failing
    // check while its promise is still pending.
    let failCheck!: (reason: Error) => void;

    updater.checkForUpdates.mockReturnValueOnce(new Promise((_resolve, reject) => {
      failCheck = reject;
    }));
    await jest.runOnlyPendingTimersAsync();

    ipcMainHandlers['update-apply']();

    updater.emit('error', new Error('check failed'));
    failCheck(new Error('check failed'));
    await flush();

    ipcMainHandlers['update-apply']();

    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('keeps the install latched when one of two overlapping checks fails', async() => {
    await setupUpdate(true);
    await flush();

    const info = makeInfo('v1.22.3');

    updater.emit('checking-for-update');
    updater.emit('update-available', info);
    updater.emit('update-downloaded', info);

    // A scheduled check is in flight when a manual retry starts a second one.
    // The retry finishes first; its completion must not conclude that no check
    // is running while the slow one is still out there to fail.
    let failSlowCheck!: (reason: Error) => void;

    updater.checkForUpdates.mockReturnValueOnce(new Promise((_resolve, reject) => {
      failSlowCheck = reject;
    }));
    await jest.runOnlyPendingTimersAsync();
    ipcMainHandlers['update-retry']();
    await flush();

    ipcMainHandlers['update-apply']();

    updater.emit('error', new Error('slow check failed'));
    failSlowCheck(new Error('slow check failed'));
    await flush();

    ipcMainHandlers['update-apply']();

    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('keeps checking after an install that did not complete', async() => {
    await setupUpdate(true);
    await flush();

    const info = makeInfo('v1.22.3');

    updater.emit('checking-for-update');
    updater.emit('update-available', info);
    updater.emit('update-downloaded', info);
    ipcMainHandlers['update-apply']();
    updater.checkForUpdates.mockClear();

    // A cancelled quit-to-install leaves the latch set, but the scheduled check
    // still has to run, or the updater wedges until the next restart.
    await jest.runOnlyPendingTimersAsync();

    expect(updater.checkForUpdates).toHaveBeenCalled();
  });

  it('checks again when the user retries a failed download', async() => {
    updater.emit('checking-for-update');
    updater.emit('update-available', makeInfo('v1.22.3'));
    updater.emit('download-progress', {
      total: 4, delta: 2, transferred: 2, percent: 50, bytesPerSecond: 2048,
    });
    updater.emit('error', new Error('download failed'));

    ipcMainHandlers['update-retry']();
    await flush();

    expect(updater.checkForUpdates).toHaveBeenCalled();
  });

  it('keeps the failed-download card up when the retry check also fails', () => {
    updater.emit('checking-for-update');
    updater.emit('update-available', makeInfo('v1.22.3'));
    updater.emit('download-progress', {
      total: 4, delta: 2, transferred: 2, percent: 50, bytesPerSecond: 2048,
    });
    updater.emit('error', new Error('download failed'));

    expect(lastState()).toMatchObject({ available: true, downloaded: false });

    // The user hits Retry and the check fails too. The card and its Retry
    // button have to stay up rather than vanish until the next scheduled check.
    updater.emit('checking-for-update');
    updater.emit('error', new Error('still offline'));

    expect(lastState().available).toBe(true);
  });

  it('schedules the next check even when a check fails', async() => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('network blip'));

    await setupUpdate(true);
    // triggerUpdateCheck runs detached; let its rejection and catch settle.
    await flush();

    // The failed check still armed the retry timer.
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    // Firing the timer runs the next check, which now succeeds.
    await jest.runOnlyPendingTimersAsync();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
