/** @jest-environment node */

import _ from 'lodash';

import type { VMExecutor } from '@pkg/backend/backend';
import type BackendHelperType from '@pkg/backend/backendHelper';
import mockModules from '@pkg/utils/testUtils/mockModules';

const modules = mockModules({
  electron: undefined,
});

describe('BackendHelper', () => {
  let BackendHelper: typeof BackendHelperType;
  beforeAll(async() => {
    BackendHelper = (await import('@pkg/backend/backendHelper')).default;
  });

  describe('configureMobyStorage', () => {
    const snapshotterDir = '/var/lib/docker/containerd/daemon/io.containerd.snapshotter.v1.overlayfs/snapshots/';
    const classicDir = '/var/lib/docker/image/overlay2/imagedb/content/sha256/'; // no-spell-check
    const DOCKER_DAEMON_JSON = '/etc/docker/daemon.json';

    interface Options {
      hasSnapshotter: boolean;
      hasClassic:     boolean;
      useWASM:        boolean;
      storageDriver:  'classic' | 'snapshotter' | 'auto';
    }

    class mockExecutor implements Partial<VMExecutor> {
      readonly options: Omit<Options, 'useWASM' | 'storageDriver'> & { existingConfig?: string; };
      readonly backend = 'mock';
      result:           any;

      constructor(options: typeof this.options) {
        this.options = options;
      }

      execCommand(...command: string[]): Promise<void>;
      execCommand(options: unknown, ...command: string[]): Promise<void>;
      execCommand(options: unknown, ...command: string[]): Promise<string>;
      execCommand(options?: unknown, ...command: string[]): Promise<void> | Promise<string> {
        if (typeof options === 'string') {
          command.unshift(options);
        }
        switch (command[0]) {
        case '/usr/bin/find':
          expect(options).toHaveProperty('capture', true);
          if (command.includes(snapshotterDir)) {
            return Promise.resolve(this.options.hasSnapshotter ? 'some text\n' : '\n');
          }
          if (command.includes(classicDir)) {
            return Promise.resolve(this.options.hasClassic ? 'not empty\n' : '\n');
          }
          break;
        case 'mkdir':
          return Promise.resolve();
        }
        throw new Error(`Unexpected command: ${ JSON.stringify(command) }`);
      }

      readFile(filePath: string): Promise<string> {
        if (filePath === DOCKER_DAEMON_JSON) {
          if (this.options.existingConfig) {
            return Promise.resolve(this.options.existingConfig);
          }
          return Promise.reject<string>(new Error('file does not exist'));
        }
        throw new Error(`Unexpected readFile: ${ filePath }`);
      }

      writeFile(filePath: string, fileContents: string): Promise<void> {
        expect(filePath).toEqual(DOCKER_DAEMON_JSON);
        const config = JSON.parse(fileContents);

        this.result = config;
        expect(config).toHaveProperty('features.containerd-snapshotter');
        return Promise.resolve();
      }
    }

    async function runTest(options: Options): Promise<boolean> {
      const vmx = new mockExecutor(options);

      await BackendHelper.configureMobyStorage(
        vmx as unknown as VMExecutor,
        options.storageDriver,
        options.useWASM);

      expect(vmx.result).toHaveProperty('features.containerd-snapshotter');

      return vmx.result.features['containerd-snapshotter'] ?? false;
    }

    function generateCases(alwaysUseWASM: boolean) {
      const cases: Omit<Options, 'storageDriver'>[] = [];
      const bools = [true, false];

      for (const hasSnapshotter of bools) {
        for (const hasClassic of bools) {
          if (!alwaysUseWASM) {
            for (const useWASM of bools) {
              cases.push({ hasSnapshotter, hasClassic, useWASM });
            }
          } else {
            cases.push({ hasSnapshotter, hasClassic, useWASM: true });
          }
        }
      }

      return cases;
    }

    it.concurrent.each(generateCases(false))(
      'should use classic storage driver when specified (snapshotter:$hasSnapshotter classic:$hasClassic wasm:$useWASM)', async(options) => {
        await expect(runTest({ ...options, storageDriver: 'classic' })).resolves.toBeFalsy();
      });

    it.concurrent.each(generateCases(false))(
      'should use snapshotter storage driver when specified (snapshotter:$hasSnapshotter classic:$hasClassic wasm:$useWASM)', async(options) => {
        await expect(runTest({ ...options, storageDriver: 'snapshotter' })).resolves.toBeTruthy();
      });

    it.concurrent.each(generateCases(true))(
      'should choose storage driver based on WASM configuration when set to auto (snapshotter:$hasSnapshotter classic:$hasClassic)', async(options) => {
        await expect(runTest({ ...options, useWASM: true, storageDriver: 'auto' })).resolves.toBeTruthy();
      });

    it.concurrent.each`
    hasSnapshotter   | hasClassic | expected
    ${ true }        | ${ true }  | ${ true }
    ${ true }        | ${ false } | ${ true }
    ${ false }       | ${ true }  | ${ false }
    ${ false }       | ${ false } | ${ true }
    `('should choose storage driver based on existing usage when set to auto and WASM disabled (snapshotter:$hasSnapshotter classic:$hasClassic)', async(options) => {
      await expect(runTest({ ...options, useWASM: false, storageDriver: 'auto' })).resolves.toBe(options.expected);
    });

    it('should preserve existing docker daemon settings', async() => {
      const existingConfig = {
        hello: 'world',
      };

      const vmx = new mockExecutor({
        hasSnapshotter:  false,
        hasClassic:      true,
        existingConfig:  JSON.stringify(existingConfig),
      });

      await BackendHelper.configureMobyStorage(
        vmx as unknown as VMExecutor,
        'auto',
        false);

      expect(vmx.result).toHaveProperty('features.containerd-snapshotter');
      expect(vmx.result).toHaveProperty('hello', 'world');
    });
  });
});
