import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { jest } from '@jest/globals';
import semver from 'semver';

import type { spawnFile as spawnFileType } from '@pkg/utils/childProcess';
import mockModules from '@pkg/utils/testUtils/mockModules';
import type getWSLVersionType from '@pkg/utils/wslVersion';
import type { WSLVersionInfo } from '@pkg/utils/wslVersion';

import type { queryUpgradeResponder as queryUpgradeResponderType, UpgradeResponderRequestPayload } from '../LonghornProvider';

const itWindows = process.platform === 'win32' ? it : it.skip;
const itUnix = process.platform !== 'win32' ? it : it.skip;
const describeWindows = process.platform === 'win32' ? describe : describe.skip;
const standardMockedVersion: WSLVersionInfo = {
  installed:       true,
  inbox:           false,
  has_kernel:      true,
  outdated_kernel: false,
  version:         {
    major:    1,
    minor:    2,
    revision: 5,
    build:    0,
  },
  kernel_version: {
    major:    5,
    minor:    0,
    revision: 13,
    build:    0,
  },
};

// The provider caches update info under `paths.cache` at module load, and
// logging creates `paths.logs` the same way, so point both somewhere disposable
// rather than at the developer's own directories.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-longhorn-test-'));
const cacheDir = path.join(tmpDir, 'cache');
const logsDir = path.join(tmpDir, 'logs');

fs.mkdirSync(cacheDir, { recursive: true });

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const modules = mockModules({
  '@pkg/utils/childProcess': { spawnFile: jest.fn<typeof spawnFileType>() },
  '@pkg/utils/osVersion':    { getMacOsVersion: jest.fn(() => new semver.SemVer('12.0.0')) },
  '@pkg/utils/paths':        { cache: cacheDir, logs: logsDir },
  '@pkg/utils/wslVersion':   { default: jest.fn<typeof getWSLVersionType>() },
  electron:                  {
    // Older than any release the tests offer, so a staged update looks newer.
    app: { getVersion: () => '1.0.0' },
    net: {
      // We only return a subset of the values, so we need a complicated type here.
      fetch: jest.fn<(...args: Parameters<typeof fetch>) => Promise<Partial<Awaited<ReturnType<typeof fetch>>>>>(),
    },
  },
});

describe('queryUpgradeResponder', () => {
  let queryUpgradeResponder: typeof queryUpgradeResponderType;

  beforeAll(async() => {
    ({ queryUpgradeResponder } = await import('../LonghornProvider'));
  });
  afterEach(() => {
    modules['@pkg/utils/childProcess'].spawnFile.mockReset();
    modules.electron.net.fetch.mockReset();
  });

  it('should return the latest version', async() => {
    modules['@pkg/utils/wslVersion'].default.mockResolvedValue(standardMockedVersion);
    modules.electron.net.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        requestIntervalInMinutes: 100,
        versions:                 [
          {
            Name:        'v1.2.3',
            ReleaseDate: 'testreleasedate',
            Supported:   true,
            Tags:        [],
          },
          {
            Name:        'v3.2.1',
            ReleaseDate: 'testreleasedate',
            Supported:   true,
            Tags:        [],
          },
          {
            Name:        'v2.1.3',
            ReleaseDate: 'testreleasedate',
            Supported:   true,
            Tags:        [],
          },
        ],
      }),
    });
    const result = await queryUpgradeResponder('testurl', new semver.SemVer('v1.2.3'));

    expect(result.latest.Name).toEqual('v3.2.1');
  });

  it('should set unsupportedUpdateAvailable to true when a newer-than-latest version is unsupported', async() => {
    modules['@pkg/utils/wslVersion'].default.mockResolvedValue(standardMockedVersion);
    modules.electron.net.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        requestIntervalInMinutes: 100,
        versions:                 [
          {
            Name:        'v1.2.3',
            ReleaseDate: 'testreleasedate',
            Supported:   true,
            Tags:        [],
          },
          {
            Name:        'v3.2.1',
            ReleaseDate: 'testreleasedate',
            Supported:   false,
            Tags:        [],
          },
          {
            Name:        'v2.1.3',
            ReleaseDate: 'testreleasedate',
            Supported:   true,
            Tags:        [],
          },
        ],
      }),
    });
    const result = await queryUpgradeResponder('testurl', new semver.SemVer('v1.2.3'));

    expect(result.unsupportedUpdateAvailable).toBe(true);
    expect(result.latest.Name).toEqual('v2.1.3');
  });

  it('should set unsupportedUpdateAvailable to false when no newer-than-latest versions are unsupported', async() => {
    modules['@pkg/utils/wslVersion'].default.mockResolvedValue(standardMockedVersion);
    modules.electron.net.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        requestIntervalInMinutes: 100,
        versions:                 [
          {
            Name:        'v1.2.3',
            ReleaseDate: 'testreleasedate',
            Supported:   true,
            Tags:        [],
          },
          {
            Name:        'v3.2.1',
            ReleaseDate: 'testreleasedate',
            Supported:   true,
            Tags:        [],
          },
          {
            Name:        'v2.1.3',
            ReleaseDate: 'testreleasedate',
            Supported:   false,
            Tags:        [],
          },
        ],
      }),
    });
    const result = await queryUpgradeResponder('testurl', new semver.SemVer('v1.2.3'));

    expect(result.unsupportedUpdateAvailable).toBe(false);
    expect(result.latest.Name).toEqual('v3.2.1');
  });

  it('should throw an error if no versions are supported', async() => {
    modules['@pkg/utils/wslVersion'].default.mockResolvedValue(standardMockedVersion);
    modules.electron.net.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        requestIntervalInMinutes: 100,
        versions:                 [
          {
            Name:        'v1.2.3',
            ReleaseDate: 'testreleasedate',
            Supported:   false,
            Tags:        [],
          },
          {
            Name:        'v3.2.1',
            ReleaseDate: 'testreleasedate',
            Supported:   false,
            Tags:        [],
          },
          {
            Name:        'v2.1.3',
            ReleaseDate: 'testreleasedate',
            Supported:   false,
            Tags:        [],
          },
        ],
      }),
    });
    const result = queryUpgradeResponder('testurl', new semver.SemVer('v1.2.3'));

    await expect(result).rejects.toThrow('Could not find latest version');
  });

  it('should treat all versions as supported when server does not include Supported key', async() => {
    modules['@pkg/utils/wslVersion'].default.mockResolvedValue(standardMockedVersion);
    modules.electron.net.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        requestIntervalInMinutes: 100,
        versions:                 [
          {
            Name:        'v1.2.3',
            ReleaseDate: 'testreleasedate',
            Tags:        [],
          },
          {
            Name:        'v3.2.1',
            ReleaseDate: 'testreleasedate',
            Tags:        [],
          },
          {
            Name:        'v2.1.3',
            ReleaseDate: 'testreleasedate',
            Tags:        [],
          },
        ],
      }),
    });
    const result = await queryUpgradeResponder('testurl', new semver.SemVer('v1.2.3'));

    expect(result.unsupportedUpdateAvailable).toBe(false);
    expect(result.latest.Name).toEqual('v3.2.1');
  });

  it('should format the current app version properly and include it in request to Upgrade Responder', async() => {
    modules.electron.net.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        requestIntervalInMinutes: 100,
        versions:                 [
          {
            Name:        'v1.2.3',
            ReleaseDate: 'testreleasedate',
            Tags:        [],
          },
        ],
      }),
    });
    const appVersion = '1.2.3';

    await queryUpgradeResponder('testurl', new semver.SemVer(appVersion));
    expect(modules.electron.net.fetch.mock.calls.length).toBe(1);
    const rawBody = modules.electron.net.fetch.mock.calls[0][1]?.body;

    expect(typeof rawBody).toBe('string');
    const body: UpgradeResponderRequestPayload = JSON.parse(rawBody as string);

    expect(body.appVersion).toBe(appVersion);
  });

  describeWindows('when we can get WSL version', () => {
    it('should include wslVersion when using store WSL', async() => {
      modules['@pkg/utils/wslVersion'].default.mockResolvedValue(standardMockedVersion);
      modules.electron.net.fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          requestIntervalInMinutes: 100,
          versions:                 [
            {
              Name:        'v1.2.3',
              ReleaseDate: 'testreleasedate',
              Tags:        [],
            },
          ],
        }),
      });
      await queryUpgradeResponder('testurl', new semver.SemVer('v1.2.3'));
      expect(modules.electron.net.fetch.mock.calls.length).toBe(1);
      const rawBody = modules.electron.net.fetch.mock.calls[0][1]?.body;

      expect(typeof rawBody).toBe('string');
      const body: UpgradeResponderRequestPayload = JSON.parse(rawBody as string);

      expect(body.extraInfo.wslVersion).toBe('1.2.5.0');
    });
    it('should include wslVersion when using inbox WSL', async() => {
      modules['@pkg/utils/wslVersion'].default.mockResolvedValue({ ...standardMockedVersion, inbox: true });
      modules.electron.net.fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          requestIntervalInMinutes: 100,
          versions:                 [
            {
              Name:        'v1.2.3',
              ReleaseDate: 'testreleasedate',
              Tags:        [],
            },
          ],
        }),
      });
      await queryUpgradeResponder('testurl', new semver.SemVer('v1.2.3'));
      expect(modules.electron.net.fetch.mock.calls.length).toBe(1);
      const rawBody = modules.electron.net.fetch.mock.calls[0][1]?.body;

      expect(typeof rawBody).toBe('string');
      const body: UpgradeResponderRequestPayload = JSON.parse(rawBody as string);

      expect(body.extraInfo.wslVersion).toBe('1.0.0');
    });
  });

  itWindows('should not include wslVersion in request to Upgrade Responder when wsl --version is unsuccessful', async() => {
    modules['@pkg/utils/wslVersion'].default.mockRejectedValue('test rejected value');
    modules.electron.net.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        requestIntervalInMinutes: 100,
        versions:                 [
          {
            Name:        'v1.2.3',
            ReleaseDate: 'testreleasedate',
            Tags:        [],
          },
        ],
      }),
    });
    await queryUpgradeResponder('testurl', new semver.SemVer('v1.2.3'));
    expect(modules.electron.net.fetch.mock.calls.length).toBe(1);
    const rawBody = modules.electron.net.fetch.mock.calls[0][1]?.body;

    expect(typeof rawBody).toBe('string');
    const body: UpgradeResponderRequestPayload = JSON.parse(rawBody as string);

    expect(body.extraInfo.wslVersion).toBe(undefined);
  });

  itUnix('should not check wsl.exe --version or include wslVersion if not on Windows', async() => {
    modules.electron.net.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        requestIntervalInMinutes: 100,
        versions:                 [
          {
            Name:        'v1.2.3',
            ReleaseDate: 'testreleasedate',
            Tags:        [],
          },
        ],
      }),
    });
    await queryUpgradeResponder('testurl', new semver.SemVer('v1.2.3'));
    expect(modules['@pkg/utils/childProcess'].spawnFile.mock.calls.length).toBe(0);
    expect(modules.electron.net.fetch.mock.calls.length).toBe(1);
    const rawBody = modules.electron.net.fetch.mock.calls[0][1]?.body;

    expect(typeof rawBody).toBe('string');
    const body: UpgradeResponderRequestPayload = JSON.parse(rawBody as string);

    expect(body.extraInfo.wslVersion).toBe(undefined);
  });
});

describe('LonghornProvider.getSha512Sum', () => {
  let LonghornProviderClass: typeof import('../LonghornProvider').default;

  beforeAll(async() => {
    ({ default: LonghornProviderClass } = await import('../LonghornProvider'));
  });
  afterEach(() => {
    modules.electron.net.fetch.mockReset();
  });

  function makeProvider() {
    return new LonghornProviderClass(
      {} as any,
      {} as any,
      { platform: 'win32' } as any,
    );
  }

  it('decodes the hex checksum and returns it as base64', async() => {
    const hex = 'a'.repeat(128);

    modules.electron.net.fetch.mockResolvedValueOnce({
      ok:         true,
      status:     200,
      statusText: 'OK',
      text:       () => Promise.resolve(`${ hex }  rancher-desktop.msi\n`),
    });

    await expect(makeProvider()['getSha512Sum']('https://example.test/cs'))
      .resolves.toBe(Buffer.from(hex, 'hex').toString('base64'));
  });

  it('rejects when the server returns a non-OK status', async() => {
    modules.electron.net.fetch.mockResolvedValueOnce({
      ok:         false,
      status:     503,
      statusText: 'Service Unavailable',
      text:       () => Promise.resolve('<html>oops</html>'),
    });

    await expect(makeProvider()['getSha512Sum']('https://example.test/cs'))
      .rejects.toThrow(/503/);
  });

  it('rejects when the response is not a valid sha512 hex string', async() => {
    modules.electron.net.fetch.mockResolvedValueOnce({
      ok:         true,
      status:     200,
      statusText: 'OK',
      text:       () => Promise.resolve('<html>oops</html>'),
    });

    await expect(makeProvider()['getSha512Sum']('https://example.test/cs'))
      .rejects.toThrow(/sha512/i);
  });
});

describe('LonghornProvider.checkForUpdates', () => {
  const cacheFile = path.join(cacheDir, 'updater-longhorn.json');
  const assetName = 'Rancher.Desktop.Setup.9.9.9.msi';
  const githubURL = 'https://api.github.com/repos/rancher-sandbox/rancher-desktop/releases/tags/v9.9.9';
  const serverURL = 'http://127.0.0.1:8314';
  let LonghornProviderClass: typeof import('../LonghornProvider').default;

  beforeAll(async() => {
    ({ default: LonghornProviderClass } = await import('../LonghornProvider'));
  });
  beforeEach(() => {
    // Documented developer variables, which every test file inherits from the
    // shell, so clear them before the first test rather than after each one.
    delete process.env.RD_FORCE_UPDATES_ENABLED;
    delete process.env.RD_GITHUB_API_URL;
    delete process.env.RD_UPGRADE_RESPONDER_URL;
    modules['@pkg/utils/wslVersion'].default.mockResolvedValue(standardMockedVersion);
  });
  afterEach(() => {
    modules.electron.net.fetch.mockReset();
    fs.rmSync(cacheFile, { force: true });
  });

  /** Answer the upgrade responder, the release lookup, and the checksum, in that order. */
  function mockRelease() {
    modules.electron.net.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        requestIntervalInMinutes: 100,
        versions:                 [{
          Name: 'v9.9.9', ReleaseDate: '2038-01-01T00:00:00Z', Supported: true, Tags: ['latest'],
        }],
      }),
    });
    modules.electron.net.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        name:         'Rancher Desktop 9.9.9',
        body:         'Simulated release.',
        published_at: '2038-01-01T00:00:00Z',
        assets:       [
          { name: assetName, browser_download_url: `${ serverURL }/msi`, size: 1 },
          { name: `${ assetName }.sha512sum`, browser_download_url: `${ serverURL }/sha512sum`, size: 1 },
        ],
      }),
    });
    modules.electron.net.fetch.mockResolvedValueOnce({
      ok:         true,
      status:     200,
      statusText: 'OK',
      text:       () => Promise.resolve(`${ 'a'.repeat(128) }  ${ assetName }\n`),
    });
  }

  // `getUpdater` points the provider at the responder override when it honours
  // one, so a test that sets the variable must configure the same URL here.
  function makeProvider(upgradeServer = 'https://upgrade.test/v1/checkupgrade') {
    return new LonghornProviderClass(
      {
        owner: 'rancher-sandbox', repo: 'rancher-desktop', vPrefixedTagName: true, upgradeServer,
      } as any,
      { currentVersion: new semver.SemVer('1.0.0') } as any,
      { platform: 'win32' } as any,
    );
  }

  /** The release lookup is the request that follows the upgrade responder query. */
  async function releaseLookupURL() {
    mockRelease();
    await makeProvider()['checkForUpdates']();

    return modules.electron.net.fetch.mock.calls[1][0];
  }

  it('fetches the release from GitHub when no override is set', async() => {
    await expect(releaseLookupURL()).resolves.toBe(githubURL);
  });

  it('honours RD_GITHUB_API_URL when updates are forced', async() => {
    process.env.RD_FORCE_UPDATES_ENABLED = '1';
    process.env.RD_GITHUB_API_URL = serverURL;

    await expect(releaseLookupURL()).resolves
      .toBe(`${ serverURL }/repos/rancher-sandbox/rancher-desktop/releases/tags/v9.9.9`);
  });

  it('ignores RD_GITHUB_API_URL unless updates are forced', async() => {
    process.env.RD_GITHUB_API_URL = serverURL;

    await expect(releaseLookupURL()).resolves.toBe(githubURL);
  });

  it('discards a cached release that came from a different API', async() => {
    // A release cached by a test run names a download and a checksum the test
    // server chose; a later run must not install it just because it is fresh.
    fs.writeFileSync(cacheFile, JSON.stringify({
      nextUpdateTime: Date.now() + 60_000,
      apiURL:         serverURL,
      upgradeServer:  '',
      file:           { url: `${ serverURL }/msi`, size: 1, checksum: 'cached' },
    }));

    await expect(releaseLookupURL()).resolves.toBe(githubURL);
  });

  it('reuses a cached release that came from the same API', async() => {
    fs.writeFileSync(cacheFile, JSON.stringify({
      nextUpdateTime: Date.now() + 60_000,
      apiURL:         'https://api.github.com',
      upgradeServer:  '',
      file:           { url: 'https://example.test/msi', size: 1, checksum: 'cached' },
    }));

    await makeProvider()['checkForUpdates']();
    expect(modules.electron.net.fetch).not.toHaveBeenCalled();
  });

  it('discards a cached release found through a different upgrade responder', async() => {
    fs.writeFileSync(cacheFile, JSON.stringify({
      nextUpdateTime: Date.now() + 60_000,
      apiURL:         'https://api.github.com',
      upgradeServer:  `${ serverURL }/v1/checkupgrade`,
      file:           { url: 'https://example.test/msi', size: 1, checksum: 'cached' },
    }));

    await expect(releaseLookupURL()).resolves.toBe(githubURL);
  });

  it('leaves no update queued from a release the run would refuse to fetch', async() => {
    const { hasQueuedUpdate } = await import('../LonghornProvider');

    // Written by a run with the test flag set; this run has neither variable.
    fs.writeFileSync(cacheFile, JSON.stringify({
      nextUpdateTime: Date.now() + 60_000,
      apiURL:         serverURL,
      upgradeServer:  '',
      isInstallable:  true,
      release:        { tag: 'v9.9.9', name: '', notes: '', date: '' },
      file:           { url: `${ serverURL }/msi`, size: 1, checksum: 'cached' },
    }));

    await expect(hasQueuedUpdate()).resolves.toBe(false);
  });

  it('queues an update staged from the servers this run would ask', async() => {
    const { hasQueuedUpdate } = await import('../LonghornProvider');

    fs.writeFileSync(cacheFile, JSON.stringify({
      nextUpdateTime: Date.now() + 60_000,
      apiURL:         'https://api.github.com',
      upgradeServer:  '',
      isInstallable:  true,
      release:        { tag: 'v9.9.9', name: '', notes: '', date: '' },
      file:           { url: 'https://example.test/msi', size: 1, checksum: 'cached' },
    }));

    await expect(hasQueuedUpdate()).resolves.toBe(true);
  });

  it('reuses the release it just cached', async() => {
    // The second query would succeed if it happened, so a cache that recorded
    // no source fails this by fetching again rather than by throwing.
    mockRelease();
    mockRelease();
    await makeProvider()['checkForUpdates']();
    const afterFirst = modules.electron.net.fetch.mock.calls.length;

    await makeProvider()['checkForUpdates']();
    expect(modules.electron.net.fetch.mock.calls).toHaveLength(afterFirst);
  });

  it('records the responder override when updates are forced', async() => {
    process.env.RD_FORCE_UPDATES_ENABLED = '1';
    process.env.RD_UPGRADE_RESPONDER_URL = `${ serverURL }/v1/checkupgrade`;
    mockRelease();

    await makeProvider(`${ serverURL }/v1/checkupgrade`)['checkForUpdates']();
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf-8')).upgradeServer)
      .toBe(`${ serverURL }/v1/checkupgrade`);
  });

  it('ignores the responder override unless updates are forced', async() => {
    process.env.RD_UPGRADE_RESPONDER_URL = `${ serverURL }/v1/checkupgrade`;
    mockRelease();

    await makeProvider()['checkForUpdates']();
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf-8')).upgradeServer).toBe('');
  });

  it('leaves no update queued from a cache that predates recorded sources', async() => {
    const { hasQueuedUpdate } = await import('../LonghornProvider');

    // The schema every installation carries into its first launch of this build.
    fs.writeFileSync(cacheFile, JSON.stringify({
      nextUpdateTime: Date.now() + 60_000,
      isInstallable:  true,
      release:        { tag: 'v9.9.9', name: '', notes: '', date: '' },
      file:           { url: 'https://example.test/msi', size: 1, checksum: 'cached' },
    }));

    await expect(hasQueuedUpdate()).resolves.toBe(false);
  });

  it('discards a cache that predates recorded sources', async() => {
    fs.writeFileSync(cacheFile, JSON.stringify({
      nextUpdateTime: Date.now() + 60_000,
      file:           { url: 'https://example.test/msi', size: 1, checksum: 'cached' },
    }));

    await expect(releaseLookupURL()).resolves.toBe(githubURL);
  });
});
