/** @jest-environment node */

import fs from 'fs';
import path from 'path';
import stream from 'stream';

import { jest } from '@jest/globals';
import { findHomeDir } from '@kubernetes/client-node';

import type { spawnFile as spawnFileType } from '@pkg/utils/childProcess';
import paths from '@pkg/utils/paths';
import mockModules from '@pkg/utils/testUtils/mockModules';

const modules = mockModules({
  fs: {
    ...fs,
    promises: {
      ...fs.promises,
      readFile: jest.spyOn(fs.promises, 'readFile'),
    },
  },
  '@pkg/utils/childProcess': { spawnFile: jest.fn<(command: string, args: string[], options: object) => Promise<{ stdout?: string }>>() },
});

jest.mock('@pkg/utils/childProcess');

const { default: runCommand, list } = await import('@pkg/main/credentialServer/credentialUtils');
const spawnFile = modules['@pkg/utils/childProcess'].spawnFile;

describe('runCommand', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  it('runs the command', async() => {
    const expected = `Some output`;

    modules.fs.promises.readFile.mockImplementation((filepath) => {
      const home = findHomeDir() ?? '';

      expect(filepath).toEqual(path.join(home, '.docker', 'config.json'));

      return Promise.resolve(JSON.stringify({ credsStore: 'pikachu' }));
    });
    spawnFile.mockImplementation((command, args, options) => {
      const resourcesPath = path.join(paths.resources, process.platform, 'bin');

      expect(command).toEqual('docker-credential-pikachu');
      expect(args).toEqual(['pika']);
      expect(options).toMatchObject({
        env:   { PATH: expect.stringContaining(resourcesPath) },
        stdio: [expect.anything(), 'pipe', expect.anything()],
      });

      return Promise.resolve({ stdout: expected }) as any;
    });
    await expect(runCommand('pika')).resolves.toEqual(expected);
  });

  it('errors out on failing to read config', async() => {
    const error = new Error('Some error');

    modules.fs.promises.readFile.mockImplementation((filepath) => {
      const home = findHomeDir() ?? '';

      expect(filepath).toEqual(path.join(home, '.docker', 'config.json'));

      return Promise.reject(error);
    });

    spawnFile.mockImplementation(() => Promise.resolve({}));

    await expect(runCommand('pika')).rejects.toBe(error);
    expect(spawnFile).not.toHaveBeenCalled();
  });

  // Check managing credentials, for the case where there's a per-host override
  // in the `credHelpers` key, as well as the case where there is no such
  // override.
  describe.each([
    {
      description: 'overridden', host: 'override.test', executable: 'bulbasaur',
    },
    {
      description: 'not overridden', host: 'default.test', executable: 'pikachu',
    },
  ])('helper $description', ({ host, executable }) => {
    beforeEach(() => {
      modules.fs.promises.readFile.mockImplementation((filepath) => {
        const home = findHomeDir() ?? '';

        expect(filepath).toEqual(path.join(home, '.docker', 'config.json'));

        return Promise.resolve(JSON.stringify({
          credsStore:  'pikachu',
          credHelpers: { 'override.test': 'bulbasaur' },
        }));
      });
    });

    // Check each action, `get`, `erase`, `store`, and an unknown action.
    // We need per-command checks here as our logic varies per command.
    test.each([
      { command: 'get', input: host },
      { command: 'erase', input: host },
      { command: 'store', input: JSON.stringify({ ServerURL: host, arg: 'x' }) },
      {
        command: 'unknown command', input: host, override: 'pikachu',
      },
    ])('on $command', async({ command, input, override }) => {
      const expected = 'password';

      spawnFile.mockImplementation((file, args, options) => {
        expect(file).toEqual(`docker-credential-${ override ?? executable }`);
        expect(args).toEqual([command]);
        expect(options).toMatchObject({ stdio: [expect.any(stream.Readable), expect.anything(), expect.anything()] });

        return Promise.resolve({ stdout: expected }) as any;
      });

      await expect(runCommand(command, input)).resolves.toEqual(expected);
    });
  });
});

describe('list', () => {
  let config: { credsStore: string, credHelpers?: Record<string, string> } = { credsStore: 'unset' };
  let helpers: Record<string, any> = {};

  beforeEach(() => {
    modules.fs.promises.readFile.mockImplementation((filepath) => {
      const home = findHomeDir() ?? '';

      expect(filepath).toEqual(path.join(home, '.docker', 'config.json'));

      return Promise.resolve(JSON.stringify(config));
    });
    spawnFile.mockImplementation((file, args) => {
      const helper = file.replace(/^docker-credential-/, '');

      expect(file).toMatch(/^docker-credential-/);
      expect(args).toEqual(['list']);

      return Promise.resolve({ stdout: JSON.stringify(helpers[helper] ?? {}) }) as any;
    });
  });

  it('uses the default helper', async() => {
    config = { credsStore: 'pikachu' };
    helpers = { pikachu: { 'host.test': 'stuff' } };
    await expect(list()).resolves.toEqual({ 'host.test': 'stuff' });
  });

  it('runs additional helpers', async() => {
    config = { credsStore: 'pikachu', credHelpers: { 'example.test': 'bulbasaur' } };
    helpers = {
      pikachu:   { 'host.test': 'stuff' },
      bulbasaur: { 'example.test': 'moar stuff' },
    };
    await expect(list()).resolves.toEqual({
      'host.test':    'stuff',
      'example.test': 'moar stuff',
    });
  });

  it('only returns matching results', async() => {
    config = { credsStore: 'pikachu', credHelpers: { 'example.test': 'bulbasaur' } };
    helpers = {
      pikachu:   { 'host.test': 'stuff' },
      bulbasaur: {
        'example.test': 'moar stuff', 'host.test': 'ignored', 'extra.test': 'also ignored',
      },
    };
    await expect(list()).resolves.toEqual({
      'host.test':    'stuff',
      'example.test': 'moar stuff',
    });
  });
});
