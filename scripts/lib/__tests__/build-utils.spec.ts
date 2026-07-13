import childProcess from 'node:child_process';

import { jest } from '@jest/globals';
import semver from 'semver';

import buildUtils from '../build-utils';

import type webpack from 'webpack';

describe('build-utils', () => {
  describe('externals', () => {
    /** Ask a config's externals handler how it would treat a request. */
    async function classify(config: Promise<webpack.Configuration>, request: string): Promise<string | undefined> {
      const [handler] = (await config).externals as any[];

      return new Promise((resolve) => {
        handler({ request }, (_error: unknown, result?: string) => resolve(result));
      });
    }

    it.each([
      // Bare dependencies keep their own resolution.
      ['electron-updater', 'module-import electron-updater'],
      ['@napi-rs/xattr', 'module-import @napi-rs/xattr'],
      // Subpaths need the extension spelled out for Node's ESM loader.
      ['electron-updater/out/MacUpdater', 'module-import electron-updater/out/MacUpdater.js'],
      ['lodash/merge', 'module-import lodash/merge.js'],
      ['lodash/isEqual.js', 'module-import lodash/isEqual.js'],
      // Optional dependencies ship with the app, so they are external too.
      ['posix-node', 'module-import posix-node'],
      // Everything else is bundled.
      ['@pkg/utils/logging', undefined],
      ['./relative', undefined],
    ])('externalizes %s', async(request, expected) => {
      await expect(classify(buildUtils.webpackConfig, request)).resolves.toBe(expected);
    });

    it('should bundle everything into the preload script', async() => {
      // A sandboxed renderer loading it from outside the asar can resolve nothing.
      await expect(buildUtils.webpackPreloadConfig.then(config => config.externals)).resolves.toEqual([]);
    });

    it.each([
      'lodash/no-such-module',
      'electron-updater/out/DoesNotExist.js',
    ])('rejects %s, which would only fail once packaged', async(request) => {
      await expect(classify(buildUtils.webpackConfig, request))
        .rejects.toThrow(`Cannot resolve external "${ request }"`);
    });
  });

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
