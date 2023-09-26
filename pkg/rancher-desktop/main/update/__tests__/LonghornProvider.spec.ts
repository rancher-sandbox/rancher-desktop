import semver from 'semver';

import { queryUpgradeResponder, UpgradeResponderRequestPayload } from '../LonghornProvider';

import { spawnFile } from '@pkg/utils/childProcess';
import fetch from '@pkg/utils/fetch';
import getWSLVersion from '@pkg/utils/wslVersion';

const itWindows = process.platform === 'win32' ? it : it.skip;
const itUnix = process.platform !== 'win32' ? it : it.skip;
const describeWindows = process.platform === 'win32' ? describe : describe.skip;
const standardMockedVersion = {
  installed:  true,
  inbox:      false,
  has_kernel: true,
  version:    {
    major:    1,
    minor:    2,
    revision: 5,
    build:    0,
  },
} as const;

jest.mock('@pkg/utils/fetch', () => {
  return {
    __esModule: true,
    default:    jest.fn(),
  };
});

jest.mock('@pkg/utils/childProcess', () => {
  return {
    __esModule: true,
    spawnFile:  jest.fn(),
  };
});

jest.mock('@pkg/utils/osVersion', () => {
  return {
    __esModule:      true,
    getMacOsVersion: jest.fn(() => {
      return new semver.SemVer('12.0.0');
    }),
  };
});

jest.mock('@pkg/utils/wslVersion', () => {
  return {
    __esModule: true,
    default:    jest.fn<ReturnType<typeof getWSLVersion>, Parameters<typeof getWSLVersion>>(),
  };
});

describe('queryUpgradeResponder', () => {
  afterEach(() => {
    jest.mocked(spawnFile).mockReset();
    jest.mocked(fetch).mockReset();
  });

  it('should return the latest version', async() => {
    jest.mocked(getWSLVersion).mockResolvedValue(standardMockedVersion);
    jest.mocked(fetch as ()=>Promise<any>).mockResolvedValueOnce({
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
    jest.mocked(getWSLVersion).mockResolvedValue(standardMockedVersion);
    jest.mocked(fetch as ()=>Promise<any>).mockResolvedValueOnce({
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
    jest.mocked(getWSLVersion).mockResolvedValue(standardMockedVersion);
    jest.mocked(fetch as ()=>Promise<any>).mockResolvedValueOnce({
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
    jest.mocked(getWSLVersion).mockResolvedValue(standardMockedVersion);
    jest.mocked(fetch as ()=>Promise<any>).mockResolvedValueOnce({
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
    jest.mocked(getWSLVersion).mockResolvedValue(standardMockedVersion);
    jest.mocked(fetch as ()=>Promise<any>).mockResolvedValueOnce({
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
    jest.mocked(fetch as ()=>Promise<any>).mockResolvedValueOnce({
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
    expect((fetch as jest.Mock).mock.calls.length).toBe(1);
    const rawBody = (fetch as jest.Mock).mock.calls[0][1].body;
    const body: UpgradeResponderRequestPayload = JSON.parse(rawBody);

    expect(body.appVersion).toBe(appVersion);
  });

  describeWindows('when we can get WSL version', () => {
    it('should include wslVersion when using store WSL', async() => {
      jest.mocked(getWSLVersion).mockResolvedValue(standardMockedVersion);
      jest.mocked(fetch as ()=>Promise<any>).mockResolvedValueOnce({
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
      expect((fetch as jest.Mock).mock.calls.length).toBe(1);
      const rawBody = (fetch as jest.Mock).mock.calls[0][1].body;
      const body: UpgradeResponderRequestPayload = JSON.parse(rawBody);

      expect(body.extraInfo.wslVersion).toBe('1.2.5.0');
    });
    it('should include wslVersion when using inbox WSL', async() => {
      jest.mocked(getWSLVersion).mockResolvedValue({ ...standardMockedVersion, inbox: true });
      jest.mocked(fetch as ()=>Promise<any>).mockResolvedValueOnce({
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
      expect((fetch as jest.Mock).mock.calls.length).toBe(1);
      const rawBody = (fetch as jest.Mock).mock.calls[0][1].body;
      const body: UpgradeResponderRequestPayload = JSON.parse(rawBody);

      expect(body.extraInfo.wslVersion).toBe('1.0.0');
    });
  });

  itWindows('should not include wslVersion in request to Upgrade Responder when wsl --version is unsuccessful', async() => {
    jest.mocked(getWSLVersion).mockRejectedValue('test rejected value');
    jest.mocked(fetch as ()=>Promise<any>).mockResolvedValueOnce({
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
    expect((fetch as jest.Mock).mock.calls.length).toBe(1);
    const rawBody = (fetch as jest.Mock).mock.calls[0][1].body;
    const body: UpgradeResponderRequestPayload = JSON.parse(rawBody);

    expect(body.extraInfo.wslVersion).toBe(undefined);
  });

  itUnix('should not check wsl.exe --version or include wslVersion if not on Windows', async() => {
    jest.mocked(fetch as ()=>Promise<any>).mockResolvedValueOnce({
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
    expect((spawnFile as jest.Mock).mock.calls.length).toBe(0);
    expect((fetch as jest.Mock).mock.calls.length).toBe(1);
    const rawBody = (fetch as jest.Mock).mock.calls[0][1].body;
    const body: UpgradeResponderRequestPayload = JSON.parse(rawBody);

    expect(body.extraInfo.wslVersion).toBe(undefined);
  });
});
