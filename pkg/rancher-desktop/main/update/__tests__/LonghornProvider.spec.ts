import semver from 'semver';

import { queryUpgradeResponder, getWslVersion } from '../LonghornProvider';

import { spawnFile } from '@pkg/utils/childProcess';
import fetch from '@pkg/utils/fetch';

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

describe('queryUpgradeResponder', () => {
  beforeAll(() => {
    (spawnFile as jest.Mock).mockResolvedValue({
      stdout: `WSL version: 1.2.5.0
Kernel version: 5.15.90.1
WSLg version: 1.0.51
MSRDC version: 1.2.3770
Direct3D version: 1.608.2-61064218
DXCore version: 10.0.25131.1002-220531-1700.rs-onecore-base2-hyp
Windows version: 10.0.19044.2846
`,
    });
  });

  afterAll(() => {
    (spawnFile as jest.Mock).mockReset();
  });

  it('should return the latest version', async() => {
    (fetch as jest.Mock).mockReturnValueOnce({
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
    (fetch as jest.Mock).mockReturnValueOnce({
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
    (fetch as jest.Mock).mockReturnValueOnce({
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
    (fetch as jest.Mock).mockReturnValueOnce({
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
    (fetch as jest.Mock).mockReturnValueOnce({
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
});

describe('getWslVersion', () => {
  afterEach(() => {
    (spawnFile as jest.Mock).mockReset();
  });

  it('should return the latest WSL version when the English version of Windows is installed', async() => {
    (spawnFile as jest.Mock).mockResolvedValueOnce({
      stdout: `WSL version: 1.2.5.0
Kernel version: 5.15.90.1
WSLg version: 1.0.51
MSRDC version: 1.2.3770
Direct3D version: 1.608.2-61064218
DXCore version: 10.0.25131.1002-220531-1700.rs-onecore-base2-hyp
Windows version: 10.0.19044.2846
`,
    });
    await expect(getWslVersion()).resolves.toEqual('1.2.5.0');
  });

  it('should return the latest WSL version when the Chinese version of Windows is installed', async() => {
    (spawnFile as jest.Mock).mockResolvedValueOnce({
      stdout: `WSL 版本： 1.0.3.0
核心版本： 5.15.79.1
WSLg 版本： 1.0.47
MSRDC 版本： 1.2.3575
Direct3D 版本： 1.606.4
DXCore 版本： 10.0.25131.1002-220531-1700.rs-onecore-base2-hyp
Windows版本： 10.0.22000.1335
`,
    });
    await expect(getWslVersion()).resolves.toEqual('1.0.3.0');
  });

  it('should return undefined when wsl --version fails', async() => {
    (spawnFile as jest.Mock).mockRejectedValue('test rejected value');
    await expect(getWslVersion()).resolves.toBe(undefined);
  });
});
