import childProcess from 'node:child_process';

import { jest } from '@jest/globals';
import semver from 'semver';

import buildUtils from '../build-utils';

describe('build-utils', () => {
  describe('docsUrl', () => {
    it.each([
      ['1.9.0', 'https://docs.rancherdesktop.io/1.9'],
      ['v1.24.187', 'https://docs.rancherdesktop.io/1.24'],
      ['v1.7.68-tech-preview', 'https://docs.rancherdesktop.io/1.7-tech-preview'],
      ['v1.86.37-1234-g56789abc', 'https://docs.rancherdesktop.io/next'],
      ['v1.8.2-fallback', 'https://docs.rancherdesktop.io/next'],
      ['v1.28.94-rc1-1234-g56789abc', 'https://docs.rancherdesktop.io/next'],
      ['invalid-version', 'https://docs.rancherdesktop.io/next'],
    ])('should return the correct docs URL for version %s', async(version, expectedUrl) => {
      jest.spyOn(buildUtils, 'version', 'get').mockResolvedValue(version);
      const docsUrl = await buildUtils.docsUrl;
      expect(docsUrl).toBe(expectedUrl);
    });
  });

  describe('computeVersion', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    /**
     * rejectGit is a mock function for execFile that results in a rejection.
     */
    const rejectGit = jest.fn<() => any>().mockRejectedValue(new Error('git command failed'));

    it('should return the mock version when valid', async() => {
      const mockVersion = '1.2.3-mock';
      jest.replaceProperty(process, 'env', { ...process.env, RD_MOCK_VERSION: mockVersion });
      const actual = await buildUtils.computeVersion();
      expect(actual).toBe(mockVersion);
    });

    it('should return git version', async() => {
      const gitVersion = '1.2.3-4-g56789abc';
      // Mock the git describe command
      function execFile(command: string, args: string[], options: childProcess.ExecFileOptions): Promise<{ stdout: string; stderr: string }> {
        expect(command).toBe('git');
        expect(args).toEqual(['describe', '--tags']);
        expect(options).toHaveProperty('cwd');
        return Promise.resolve({ stdout: `v${ gitVersion }\n` }) as any;
      }
      const version = await buildUtils.computeVersion(execFile as any);
      expect(version).toBe(gitVersion);
    });

    it('should return package.json version when git command fails', async() => {
      const version = '1.2.3-package';
      jest.spyOn(buildUtils, 'packageMeta', 'get').mockReturnValue({ version } as any);
      const actual = buildUtils.computeVersion(rejectGit);
      await expect(actual).resolves.toBe(`${ version }-fallback`);
    });

    it('should return fallback version when no version is valid', async() => {
      jest.spyOn(semver, 'valid').mockReturnValue(null);
      const version = await buildUtils.computeVersion(rejectGit);
      expect(version).toBe('0.0.0-fallback');
    });
  });
});
