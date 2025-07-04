import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import { jest } from '@jest/globals';

import * as childProcess from '@pkg/utils/childProcess';
import paths from '@pkg/utils/paths';
import mockModules from '../testUtils/mockModules';

import type DockerDirManager from '@pkg/utils/dockerDirManager';

const spawnFile = childProcess.spawnFile;
const modules = mockModules({
  '@pkg/utils/childProcess': {
    ...childProcess,
    spawnFile: jest.fn<(command: string, args: string[], options: any) => Promise<{}>>(),
  },
  '@pkg/utils/logging': {
    background: {
      debug: jest.fn(),
      /** Mocked console.log() to check messages. */
      log: jest.fn(),
    },
  },
  '@pkg/utils/paths': {
    ...paths,
    resources: paths.resources,
  },
});

const itUnix = os.platform() === 'win32' ? it.skip : it;
const itDarwin = os.platform() === 'darwin' ? it : it.skip;
const itLinux = os.platform() === 'linux' ? it : it.skip;
const describeUnix = os.platform() === 'win32' ? describe.skip : describe;
const { default: DockerDirManagerCtor } = await import('@pkg/utils/dockerDirManager');

describe('DockerDirManager', () => {
  /** The instance of LimaBackend under test. */
  let subj: DockerDirManager;
  /** A directory we can use for scratch files during the test. */
  let workdir: string;

  beforeEach(async() => {
    modules['@pkg/utils/childProcess'].spawnFile.mockImplementation(spawnFile)
    await expect((async() => {
      workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rancher-desktop-lima-test-'));
      subj = new DockerDirManagerCtor(path.join(workdir, '.docker'));
    })()).resolves.toBeUndefined();
  });
  afterEach(async() => {
    modules['@pkg/utils/logging'].background.log.mockReset();
    await fs.promises.rm(workdir, { recursive: true });
  });

  describe('getDesiredDockerContext', () => {
    it('should clear context when we own the default socket', async() => {
      await expect(subj['getDesiredDockerContext'](true, undefined)).resolves.toBeUndefined();
      await expect(subj['getDesiredDockerContext'](true, 'pikachu')).resolves.toBeUndefined();
    });

    itUnix('should return rancher-desktop when no config and no control over socket', async() => {
      await expect(subj['getDesiredDockerContext'](false, undefined)).resolves.toEqual('rancher-desktop');
    });

    itUnix('should do nothing if context is already set to rancher-desktop', async() => {
      await expect(subj['getDesiredDockerContext'](false, 'rancher-desktop')).resolves.toEqual('rancher-desktop');
    });

    itUnix('should return current context when that context is tcp', async() => {
      const getCurrentDockerSocketMock = jest.spyOn(subj as any, 'getCurrentDockerSocket')
        .mockResolvedValue('some-url');

      try {
        const currentContext = 'pikachu';

        await expect(subj['getDesiredDockerContext'](false, currentContext)).resolves.toEqual(currentContext);
      } finally {
        getCurrentDockerSocketMock.mockRestore();
      }
    });

    itUnix('should return current context when that context is unix socket', async() => {
      const unixSocketPath = path.join(workdir, 'test-socket');
      const unixSocketPathWithUnix = `unix://${ unixSocketPath }`;
      const unixSocketServer = net.createServer();

      unixSocketServer.listen(unixSocketPath);
      const getCurrentDockerSocketMock = jest.spyOn(subj as any, 'getCurrentDockerSocket')
        .mockResolvedValue(unixSocketPathWithUnix);

      try {
        const currentContext = 'pikachu';

        await expect(subj['getDesiredDockerContext'](false, currentContext)).resolves.toEqual(currentContext);
      } finally {
        getCurrentDockerSocketMock.mockRestore();
        await new Promise((resolve) => {
          unixSocketServer.close(() => resolve(null));
        });
      }
    });
  });

  describeUnix('ensureDockerContextFile', () => {
    /** Path to the docker context metadata file (in workdir). */
    let metaPath: string;
    /** Path to the docker socket Rancher Desktop is providing. */
    let sockPath: string;

    beforeEach(() => {
      metaPath = path.join(workdir, '.docker', 'contexts', 'meta',
        'b547d66a5de60e5f0843aba28283a8875c2ad72e99ba076060ef9ec7c09917c8',
        'meta.json');
      sockPath = path.join(workdir, 'docker.sock');
    });

    it('should create additional docker context if none exists', async() => {
      await expect(subj['ensureDockerContextFile'](sockPath)).resolves.toBeUndefined();
      const result = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));

      expect(result).toEqual({
        Endpoints: {
          docker: {
            Host:          `unix://${ sockPath }`,
            SkipTLSVerify: false,
          },
        },
        Metadata: { Description: 'Rancher Desktop moby context' },
        Name:     'rancher-desktop',
      });
      expect(modules['@pkg/utils/logging'].background.log).not.toHaveBeenCalled();
    });
  });

  describe('ensureDockerContextConfigured', () => {
    /** Path to the docker config file (in workdir). */
    let configPath: string;
    /** Path to a secondary docker context metadata file, for existing contexts. */
    let altMetaPath: string;
    /** Path to the docker socket Rancher Desktop is providing. */
    let sockPath: string;
    /** Path to a secondary docker socket, for existing contexts. */
    let altSockPath: string;

    beforeEach(() => {
      configPath = path.join(workdir, '.docker', 'config.json');
      altMetaPath = path.join(workdir, '.docker', 'contexts', 'meta',
        '43999461d22f67840fcd9b8824293eaa4f18146e57b2c651bcd925e3b3e4e429',
        'meta.json');
      sockPath = path.join(workdir, 'docker.sock');
      altSockPath = path.join(workdir, 'pikachu.sock');
    });

    itUnix('should not touch working unix socket', async() => {
      const server = net.createServer();

      try {
        await new Promise<void>(resolve => server.listen(altSockPath, resolve));
        await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
        await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
        await fs.promises.mkdir(path.dirname(altMetaPath), { recursive: true });
        await fs.promises.writeFile(altMetaPath, JSON.stringify({
          Name:      'pikachu',
          Endpoints: { docker: { Host: `unix://${ altSockPath }` } },
        }));
        await expect(subj.ensureDockerContextConfigured(false, sockPath)).resolves.toBeUndefined();

        expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toHaveProperty('currentContext', 'pikachu');
      } finally {
        server.close();
      }
    });

    itUnix('should change context when current points to nonexistent socket', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
      await fs.promises.mkdir(path.dirname(altMetaPath), { recursive: true });
      await fs.promises.writeFile(altMetaPath, JSON.stringify({
        Name:      'pikachu',
        Endpoints: { docker: { Host: `unix://${ altSockPath }` } },
      }));

      await expect(subj.ensureDockerContextConfigured(false, sockPath)).resolves.toBeUndefined();

      expect(modules['@pkg/utils/logging'].background.log.mock.calls).toContainEqual([
        expect.stringMatching(`Could not read existing docker socket.*${ workdir }.*pikachu.*ENOENT`),
      ]);

      expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toHaveProperty('currentContext', 'rancher-desktop');
    });

    itUnix('should change context when existing is invalid', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
      await fs.promises.mkdir(path.dirname(altMetaPath), { recursive: true });
      await fs.promises.writeFile(altMetaPath, JSON.stringify({
        Name:      'pikachu',
        Endpoints: { docker: { Host: `unix://${ altSockPath }` } },
      }));
      await fs.promises.writeFile(altSockPath, '');

      await expect(subj.ensureDockerContextConfigured(false, sockPath)).resolves.toBeUndefined();

      expect(modules['@pkg/utils/logging'].background.log.mock.calls).toContainEqual([
        expect.stringMatching(`Invalid existing context.*pikachu.*${ workdir }`),
      ]);

      expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toHaveProperty('currentContext', 'rancher-desktop');
    });

    itUnix('should not change context if existing is tcp socket', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
      await fs.promises.mkdir(path.dirname(altMetaPath), { recursive: true });
      await fs.promises.writeFile(altMetaPath, JSON.stringify({
        Name:      'pikachu',
        Endpoints: { docker: { Host: `tcp://server.test:1234` } },
      }));
      await expect(subj.ensureDockerContextConfigured(false, sockPath)).resolves.toBeUndefined();

      expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toHaveProperty('currentContext', 'pikachu');
    });

    itUnix('should allow for existing invalid context configuration', async() => {
      const metaDir = path.join(workdir, '.docker', 'contexts', 'meta');
      const statMock = jest.spyOn(fs.promises, 'stat')
        .mockImplementation((pathLike: fs.PathLike, opts?: fs.StatOptions | undefined) => {
          expect(pathLike).toEqual('/var/run/docker.sock');

          throw new Error(`ENOENT: no such file or directory, stat ${ pathLike }`);
        });

      try {
        await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
        await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
        await fs.promises.mkdir(path.join(metaDir, 'invalid-context', 'meta.json'), { recursive: true });
        await fs.promises.writeFile(path.join(metaDir, 'invalid-context-two'), '');
        await expect(subj.ensureDockerContextConfigured(false, sockPath)).resolves.toBeUndefined();

        expect(modules['@pkg/utils/logging'].background.log.mock.calls).toContainEqual([
          expect.stringMatching(`Failed to read context.*invalid-context.*EISDIR`),
        ]);
        expect(modules['@pkg/utils/logging'].background.log.mock.calls).toContainEqual([
          expect.stringMatching(`Failed to read context.*invalid-context-two.*ENOTDIR`),
        ]);
        expect(modules['@pkg/utils/logging'].background.log.mock.calls).toContainEqual([
          expect.stringMatching(`Could not read existing docker socket.*ENOENT`),
        ]);
      } finally {
        statMock.mockRestore();
      }
    });
  });

  describe('ensureCredHelperConfigured', () => {
    /** Path to the docker config file (in workdir). */
    let configPath: string;

    beforeEach(() => {
      configPath = path.join(workdir, '.docker', 'config.json');
    });

    it('should throw errors reading config.json', async() => {
      await fs.promises.mkdir(configPath, { recursive: true });
      await expect(subj.ensureCredHelperConfigured()).rejects.toThrow('EISDIR');
      expect(modules['@pkg/utils/logging'].background.log).not.toHaveBeenCalled();
    });

    it('should set credsStore to default when undefined', async() => {
      await subj.ensureCredHelperConfigured();
      const rawConfig = await fs.promises.readFile(configPath, 'utf-8');
      const newConfig = JSON.parse(rawConfig);

      expect(newConfig.credsStore).toEqual(await subj['getCredsStoreFor'](undefined));
    });

    it('should set credsStore to platform default when it is "desktop"', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ credsStore: 'desktop' }));
      await subj.ensureCredHelperConfigured();
      const rawConfig = await fs.promises.readFile(configPath, 'utf-8');
      const newConfig = JSON.parse(rawConfig);

      expect(newConfig.credsStore).toEqual(await subj['getCredsStoreFor']('desktop'));
    });

    it('should not change any irrelevant keys in config.json', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ otherKey: 'otherValue' }));
      await subj.ensureCredHelperConfigured();
      const newConfig = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));

      expect(newConfig).toHaveProperty('otherKey', 'otherValue');
    });
  });

  describe('clearDockerContext', () => {
    /** Path to the docker config file (in workdir). */
    let configPath: string;
    /** Path to the docker context metadata file (in workdir). */
    let metaPath: string;

    beforeEach(() => {
      configPath = path.join(workdir, '.docker', 'config.json');
      metaPath = path.join(workdir, '.docker', 'contexts', 'meta',
        'b547d66a5de60e5f0843aba28283a8875c2ad72e99ba076060ef9ec7c09917c8',
        'meta.json');
    });

    it('should remove the docker context directory', async() => {
      await fs.promises.mkdir(path.dirname(metaPath), { recursive: true });
      await fs.promises.writeFile(metaPath, 'irrelevant');

      await expect(subj['clearDockerContext']()).resolves.toBeUndefined();
      await expect(fs.promises.lstat(path.dirname(metaPath))).rejects.toThrow('ENOENT');
    });

    it('should unset docker context as needed', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'rancher-desktop' }));
      await expect(subj['clearDockerContext']()).resolves.toBeUndefined();

      const contents = JSON.parse(await fs.promises.readFile(configPath, 'utf-8')) ?? {};

      expect(contents).not.toHaveProperty('currentContext');
    });

    it('should not unset unrelated docker context', async() => {
      const context = 'unrelated-context';

      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: context }));
      await expect(subj['clearDockerContext']()).resolves.toBeUndefined();

      const contents = JSON.parse(await fs.promises.readFile(configPath, 'utf-8')) ?? {};

      expect(contents).toHaveProperty('currentContext', context);
    });

    it('should not fail if docker config is missing', async() => {
      await fs.promises.mkdir(path.dirname(metaPath), { recursive: true });
      await fs.promises.writeFile(metaPath, 'irrelevant');

      await expect(subj['clearDockerContext']()).resolves.toBeUndefined();
    });
  });

  describe('credHelperWorking', () => {
    const commonCredHelperExpectations: (...args: Parameters<typeof childProcess.spawnFile>) => void = (command, args, options) => {
      expect(command).toEqual('docker-credential-mockhelper');
      expect(args[0]).toEqual('list');
      expect(options.stdio[0]).toBe('ignore');
      expect(options.stdio[1]).toBe('ignore');
      expect(options.stdio[2]).toBe(modules['@pkg/utils/logging'].background);
    };

    beforeEach(() => {
      modules['@pkg/utils/paths'].resources = 'RESOURCES';
    });
    afterEach(() => {
      modules['@pkg/utils/childProcess'].spawnFile.mockRestore();
      modules['@pkg/utils/paths'].resources = paths.resources;
    });

    it('should return false when cred helper is not working', async() => {
      modules['@pkg/utils/childProcess'].spawnFile
        .mockImplementation((command, args, options) => {
          commonCredHelperExpectations(command, args, options);

          return Promise.reject(new Error('not a valid cred-helper'));
        });
      await expect(subj['credHelperWorking']('mockhelper')).resolves.toBeFalsy();
    });

    it('should return true when cred helper is working', async() => {
      modules['@pkg/utils/childProcess'].spawnFile
        .mockImplementation((command, args, options) => {
          commonCredHelperExpectations(command, args, options);

          return Promise.resolve({});
        });
      await expect(subj['credHelperWorking']('mockhelper')).resolves.toBeTruthy();
    });

    it('should blacklist docker-credentials-desktop', async() => {
      modules['@pkg/utils/childProcess'].spawnFile
        .mockRejectedValue('not called');
      await expect(subj['credHelperWorking']('desktop')).resolves.toBeFalsy();
      expect(modules['@pkg/utils/childProcess'].spawnFile).not.toHaveBeenCalled();
    });

    it('should test cred helper with resources in path', async() => {
      modules['@pkg/utils/childProcess'].spawnFile
        .mockImplementation((command, args, options) => {
          commonCredHelperExpectations(command, args, options);

          expect((options.env?.PATH ?? '').split(path.delimiter)).toContain(path.join('RESOURCES', os.platform(), 'bin'));

          return Promise.resolve({});
        });
      await expect(subj['credHelperWorking']('mockhelper')).resolves.toBeTruthy();
    });

    itDarwin('should test cred helper with /usr/local/bin in path', async() => {
      modules['@pkg/utils/childProcess'].spawnFile
        .mockImplementation((command, args, options) => {
          commonCredHelperExpectations(command, args, options);

          expect((options.env?.PATH ?? '').split(path.delimiter)).toContain('/usr/local/bin');

          return Promise.resolve({});
        });
      await expect(subj['credHelperWorking']('mockhelper')).resolves.toBeTruthy();
    });
  });

  describe('getCredsStoreFor', () => {
    const platformDefaultHelper = ({
      linux:  'pass',
      darwin: 'osxkeychain',
      win32:  'wincred',
    } as Record<string, string>)[os.platform()];

    afterEach(() => {
      jest.spyOn(subj as any, 'credHelperWorking').mockRestore();
    });

    it('should return existing cred helper if it works', async() => {
      const helperName = 'mock-helper';

      jest.spyOn(subj as any, 'credHelperWorking').mockResolvedValue(true);
      await expect(subj['getCredsStoreFor'](helperName)).resolves.toEqual(helperName);
    });

    it('should return the right cred helper for the right platform', async() => {
      await expect(subj['getCredsStoreFor'](undefined)).resolves.toEqual(platformDefaultHelper);
    });

    it('should return the platform helper if the existing one does not work', async() => {
      jest.spyOn(subj as any, 'credHelperWorking').mockResolvedValue(false);
      await expect(subj['getCredsStoreFor']('broken-helper')).resolves.toEqual(platformDefaultHelper);
    });

    itLinux('should return secretservice when that is the current value', async() => {
      jest.spyOn(subj as any, 'credHelperWorking').mockResolvedValue(false);
      await expect(subj['getCredsStoreFor']('secretservice')).resolves.toEqual('secretservice');
    });
  });
});
