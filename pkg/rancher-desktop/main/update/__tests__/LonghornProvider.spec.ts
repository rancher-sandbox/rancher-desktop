import { jest } from '@jest/globals';
import semver from 'semver';

import type { spawnFile as spawnFileType } from '@pkg/utils/childProcess';
import type fetchType from '@pkg/utils/fetch';
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

const modules = mockModules({
  '@pkg/utils/fetch':        { default: jest.fn<(...args: Parameters<typeof fetchType>) => Promise<Partial<Awaited<ReturnType<typeof fetchType>>>>>() },
  '@pkg/utils/childProcess': { spawnFile: jest.fn<typeof spawnFileType>() },
  '@pkg/utils/osVersion':    { getMacOsVersion: jest.fn(() => new semver.SemVer('12.0.0')) },
  '@pkg/utils/wslVersion':   { default: jest.fn<typeof getWSLVersionType>() },
});

describe('queryUpgradeResponder', () => {
  const fetch = modules['@pkg/utils/fetch'].default;
  let queryUpgradeResponder: typeof queryUpgradeResponderType;

  beforeAll(async() => {
    ({ queryUpgradeResponder } = await import('../LonghornProvider'));
  });
  afterEach(() => {
    modules['@pkg/utils/childProcess'].spawnFile.mockReset();
    fetch.mockReset();
  });

  it('should return the latest version', async() => {
    modules['@pkg/utils/wslVersion'].default.mockResolvedValue(standardMockedVersion);
    fetch.mockResolvedValueOnce({
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
    fetch.mockResolvedValueOnce({
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
    fetch.mockResolvedValueOnce({
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
    fetch.mockResolvedValueOnce({
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
    fetch.mockResolvedValueOnce({
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
    fetch.mockResolvedValueOnce({
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
    expect(fetch.mock.calls.length).toBe(1);
    const rawBody = fetch.mock.calls[0][1]?.body;

    expect(typeof rawBody).toBe('string');
    const body: UpgradeResponderRequestPayload = JSON.parse(rawBody as string);

    expect(body.appVersion).toBe(appVersion);
  });

  describeWindows('when we can get WSL version', () => {
    it('should include wslVersion when using store WSL', async() => {
      modules['@pkg/utils/wslVersion'].default.mockResolvedValue(standardMockedVersion);
      fetch.mockResolvedValueOnce({
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
      expect(fetch.mock.calls.length).toBe(1);
      const rawBody = fetch.mock.calls[0][1]?.body;

      expect(typeof rawBody).toBe('string');
      const body: UpgradeResponderRequestPayload = JSON.parse(rawBody as string);

      expect(body.extraInfo.wslVersion).toBe('1.2.5.0');
    });
    it('should include wslVersion when using inbox WSL', async() => {
      modules['@pkg/utils/wslVersion'].default.mockResolvedValue({ ...standardMockedVersion, inbox: true });
      fetch.mockResolvedValueOnce({
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
      expect(fetch.mock.calls.length).toBe(1);
      const rawBody = fetch.mock.calls[0][1]?.body;

      expect(typeof rawBody).toBe('string');
      const body: UpgradeResponderRequestPayload = JSON.parse(rawBody as string);

      expect(body.extraInfo.wslVersion).toBe('1.0.0');
    });
  });

  itWindows('should not include wslVersion in request to Upgrade Responder when wsl --version is unsuccessful', async() => {
    modules['@pkg/utils/wslVersion'].default.mockRejectedValue('test rejected value');
    fetch.mockResolvedValueOnce({
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
    expect(fetch.mock.calls.length).toBe(1);
    const rawBody = fetch.mock.calls[0][1]?.body;

    expect(typeof rawBody).toBe('string');
    const body: UpgradeResponderRequestPayload = JSON.parse(rawBody as string);

    expect(body.extraInfo.wslVersion).toBe(undefined);
  });

  itUnix('should not check wsl.exe --version or include wslVersion if not on Windows', async() => {
    fetch.mockResolvedValueOnce({
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
    expect(fetch.mock.calls.length).toBe(1);
    const rawBody = fetch.mock.calls[0][1]?.body;

    expect(typeof rawBody).toBe('string');
    const body: UpgradeResponderRequestPayload = JSON.parse(rawBody as string);

    expect(body.extraInfo.wslVersion).toBe(undefined);
  });
});
