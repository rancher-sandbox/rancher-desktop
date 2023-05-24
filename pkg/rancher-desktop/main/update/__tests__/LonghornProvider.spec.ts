import semver from 'semver';

import { queryUpgradeResponder } from '../LonghornProvider';

import fetch from '@pkg/utils/fetch';

jest.mock('@pkg/utils/fetch', () => {
  return {
    __esModule: true,
    default:    jest.fn(),
  };
});

describe('queryUpgradeResponder', () => {
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
