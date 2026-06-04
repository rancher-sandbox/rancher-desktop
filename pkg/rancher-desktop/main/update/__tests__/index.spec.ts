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

mockModules({
  electron:                                  { ipcMain: { on: jest.fn() } },
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
    // Reset to a clean slate: error cleared, no staged version, updater re-armed.
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

  it('reports an updater error and clears the downloaded flag', () => {
    const info = makeInfo('v1.22.3');

    updater.emit('checking-for-update');
    updater.emit('update-available', info);
    updater.emit('update-downloaded', info);

    expect(lastState().downloaded).toBe(true);

    const error = new Error('download failed');

    updater.emit('error', error);

    expect(lastState().downloaded).toBe(false);
    expect(lastState().error).toBe(error);
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
