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

  checkForUpdates = jest.fn(() => Promise.resolve({ updateInfo: { nextUpdateTime: Date.now() + 100_000 } }));
  quitAndInstall = jest.fn();
}

const appUpdateConfigPath = path.join(os.tmpdir(), 'rd-update-state-machine-test.yaml');

class FakeElectronAppAdapter {
  get appUpdateConfigPath(): string {
    return appUpdateConfigPath;
  }
}

const sentStates: UpdateState[] = [];
const send = jest.fn((_channel: string, state: UpdateState) => {
  sentStates.push({ ...state });
});
const setHasQueuedUpdate = jest.fn<(isQueued: boolean) => Promise<void>>();
const hasQueuedUpdate = jest.fn<() => Promise<boolean>>(() => Promise.resolve(false));
const timersMock = { setTimeout: jest.fn(() => 0), clearTimeout: jest.fn() };
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
  timers:                                    timersMock,
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
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('setupUpdate state machine', () => {
  let setupUpdate: typeof import('../index').default;
  let updater: FakeUpdater;

  beforeAll(async() => {
    fs.writeFileSync(appUpdateConfigPath, '{}');
    ({ default: setupUpdate } = await import('../index'));

    await setupUpdate(true);
    await flush();
    updater = updaterInstances[updaterInstances.length - 1];
  });

  afterAll(() => {
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
    timersMock.setTimeout.mockClear();
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

    // A later scheduled check finds the same version still available. The
    // restart button must remain.
    updater.emit('checking-for-update');
    updater.emit('update-available', info);

    expect(lastState()).toMatchObject({ available: true, downloaded: true });
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

  it('does not re-download a version that is already staged', () => {
    const info = makeInfo('v1.22.3');

    updater.emit('checking-for-update');
    updater.emit('update-available', info);
    updater.emit('update-downloaded', info);

    expect(updater.autoDownload).toBe(false);

    updater.emit('checking-for-update');
    updater.emit('update-available', info);

    expect(updater.autoDownload).toBe(false);
    expect(lastState()).toMatchObject({ downloaded: true });
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

  it('reports an updater error and clears the downloaded flag', () => {
    const info = makeInfo('v1.22.3');

    updater.emit('checking-for-update');
    updater.emit('update-available', info);
    updater.emit('update-downloaded', info);

    expect(lastState().downloaded).toBe(true);

    updater.emit('error', new Error('download failed'));

    expect(lastState().downloaded).toBe(false);
    expect(lastState().error).toBeInstanceOf(Error);
  });

  it('clears a previous error once a later check succeeds', () => {
    updater.emit('error', new Error('boom'));

    expect(lastState().error).toBeInstanceOf(Error);

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

  it('schedules the next check even when a check fails', async() => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('network blip'));

    await setupUpdate(true);
    // triggerUpdateCheck runs detached; let its rejection and catch settle.
    await flush();

    expect(timersMock.setTimeout).toHaveBeenCalled();
  });
});
