import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import childProcess from 'child_process';

import DockerDirManager from '@/utils/dockerDirManager';

const itUnix = os.platform() === 'win32' ? it.skip : it;

describe('DockerDirManager', () => {
  /** The instance of LimaBackend under test. */
  let subj: DockerDirManager;
  /** A directory we can use for scratch files during the test. */
  let workdir: string;
  /** Mocked console.log() to check messages. */
  let consoleMock: jest.SpyInstance<void, [message?: any, ...optionalArgs: any[]]>;

  beforeEach(async() => {
    await expect((async() => {
      workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rancher-desktop-lima-test-'));
      consoleMock = jest.spyOn(console, 'log');
      subj = new DockerDirManager(path.join(workdir, '.docker'));
    })()).resolves.toBeUndefined();
  });
  afterEach(async() => {
    consoleMock.mockReset();
    await fs.promises.rm(workdir, { recursive: true });
  });

  describe('getDesiredDockerContext', () => {
    it('should clear context when we own the default socket', async() => {
      await expect(subj.getDesiredDockerContext(true, undefined)).resolves.toBeUndefined();
      await expect(subj.getDesiredDockerContext(true, 'pikachu')).resolves.toBeUndefined();
    });

    it('should return rancher-desktop when no config and no control over socket', async() => {
      await expect(subj.getDesiredDockerContext(false, undefined)).resolves.toEqual('rancher-desktop');
    });

    it('should do nothing if context is already set to rancher-desktop', async() => {
      await expect(subj.getDesiredDockerContext(false, 'rancher-desktop')).resolves.toEqual('rancher-desktop');
    });

    it('should return current context when that context is tcp', async() => {
      const getCurrentDockerSocketMock = jest.spyOn(subj, 'getCurrentDockerSocket')
        .mockResolvedValue('some-url');

      try {
        const currentContext = 'pikachu';
        await expect(subj.getDesiredDockerContext(false, currentContext)).resolves.toEqual(currentContext);
      } finally {
        getCurrentDockerSocketMock.mockRestore();
      }
    });

    itUnix('should return current context when that context is unix socket', async() => {
      const unixSocketPath = path.join(workdir, 'test-socket');
      const unixSocketPathWithUnix = `unix://${ unixSocketPath }`;
      const unixSocketServer = net.createServer();
      unixSocketServer.listen(unixSocketPath);
      const getCurrentDockerSocketMock = jest.spyOn(subj, 'getCurrentDockerSocket')
        .mockResolvedValue(unixSocketPathWithUnix);

      try {
        const currentContext = 'pikachu';
        await expect(subj.getDesiredDockerContext(false, currentContext)).resolves.toEqual(currentContext);
      } finally {
        getCurrentDockerSocketMock.mockRestore();
        await new Promise((resolve) => {
          unixSocketServer.close(() => resolve(null));
        });
      }
    });
  });

  describe('ensureDockerContext', () => {
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
      await expect(subj.ensureDockerContext(sockPath, undefined)).resolves.toBeUndefined();
      const result = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));

      expect(result).toEqual({
        Endpoints: {
          docker: {
            Host:          `unix://${ sockPath }`,
            SkipTLSVerify: false,
          }
        },
        Metadata: { Description: 'Rancher Desktop moby context' },
        Name:     'rancher-desktop',
      });
      expect(consoleMock).not.toHaveBeenCalled();
    });

    it('should add a kubernetes section if kubernetesEndpoint is not undefined', async() => {
      const kubernetesEndpoint = 'some-endpoint';
      await expect(subj.ensureDockerContext(sockPath, kubernetesEndpoint)).resolves.toBeUndefined();
      const result = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));

      expect(result).toEqual({
        Endpoints: {
          docker: {
            Host:          `unix://${ sockPath }`,
            SkipTLSVerify: false,
          },
          kubernetes: {
            Host:             kubernetesEndpoint,
            SkipTLSVerify:    true,
            DefaultNamespace: 'default',
          },
        },
        Metadata: { Description: 'Rancher Desktop moby context' },
        Name:     'rancher-desktop',
      });
      expect(consoleMock).not.toHaveBeenCalled();
    });
  });

  describe('ensureDockerConfig', () => {
    /** Path to the docker config file (in workdir). */
    let configPath: string;
    /** Path to the docker context metadata file (in workdir). */
    let metaPath: string;
    /** Path to a secondary docker context metadata file, for existing contexts. */
    let altMetaPath: string;
    /** Path to the docker socket Rancher Desktop is providing. */
    let sockPath: string;
    /** Path to a secondary docker socket, for existing contexts. */
    let altSockPath: string;

    beforeEach(() => {
      configPath = path.join(workdir, '.docker', 'config.json');
      metaPath = path.join(workdir, '.docker', 'contexts', 'meta',
        'b547d66a5de60e5f0843aba28283a8875c2ad72e99ba076060ef9ec7c09917c8',
        'meta.json');
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
        await expect(subj.ensureDockerConfig(false, sockPath, undefined)).resolves.toBeUndefined();

        expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toHaveProperty('currentContext', 'pikachu');
        expect(consoleMock).toHaveBeenCalledWith(
          expect.stringMatching(`Read existing docker config.*`),
          expect.anything());
        expect(consoleMock).toHaveBeenCalledWith(
          expect.stringMatching(`Writing modified docker config.*`),
          expect.anything());
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

      await expect(subj.ensureDockerConfig(false, sockPath, undefined)).resolves.toBeUndefined();

      expect(consoleMock).toHaveBeenCalledWith(
        expect.stringMatching(`Could not read existing docker socket.*${ workdir }.*pikachu.*ENOENT`),
        expect.anything());

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

      await expect(subj.ensureDockerConfig(false, sockPath, undefined)).resolves.toBeUndefined();

      expect(consoleMock).toHaveBeenCalledWith(
        expect.stringMatching(`Invalid existing context.*pikachu.*${ workdir }`),
        expect.anything());

      expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toHaveProperty('currentContext', 'rancher-desktop');
    });

    it('should not change context if existing is tcp socket', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
      await fs.promises.mkdir(path.dirname(altMetaPath), { recursive: true });
      await fs.promises.writeFile(altMetaPath, JSON.stringify({
        Name:      'pikachu',
        Endpoints: { docker: { Host: `tcp://server.test:1234` } },
      }));
      await expect(subj.ensureDockerConfig(false, sockPath, undefined)).resolves.toBeUndefined();

      expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toHaveProperty('currentContext', 'pikachu');
      expect(consoleMock).toHaveBeenCalledWith(
        expect.stringMatching(`Read existing docker config.*`),
        expect.anything());
      expect(consoleMock).toHaveBeenCalledWith(
        expect.stringMatching(`Writing modified docker config.*`),
        expect.anything());
    });

    itUnix('should update kubernetes endpoint', async() => {
      const kubeURL = 'http://kubernetes.test:2345';

      await expect(subj.ensureDockerConfig(false, sockPath, kubeURL)).resolves.toBeUndefined();

      const result = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));

      expect(result).toHaveProperty('Name', 'rancher-desktop');
      expect(result).toHaveProperty('Endpoints.kubernetes.Host', kubeURL);
      expect(consoleMock).toHaveBeenCalledWith(
        expect.stringMatching(`Read existing docker config.*`),
        expect.anything());
      expect(consoleMock).toHaveBeenCalledWith(
        expect.stringMatching(`Writing modified docker config.*`),
        expect.anything());
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
        await expect(subj.ensureDockerConfig(false, sockPath, undefined)).resolves.toBeUndefined();

        expect(consoleMock).toHaveBeenCalledWith(
          expect.stringMatching(`Failed to read context.*invalid-context.*EISDIR`),
          expect.anything());
        expect(consoleMock).toHaveBeenCalledWith(
          expect.stringMatching(`Failed to read context.*invalid-context-two.*ENOTDIR`),
          expect.anything());
        expect(consoleMock).toHaveBeenCalledWith(
          expect.stringMatching(`Could not read existing docker socket.*ENOENT`),
          expect.anything());
      } finally {
        statMock.mockRestore();
      }
    });

    it('should throw errors reading config.json', async() => {
      await fs.promises.mkdir(configPath, { recursive: true });
      await expect(subj.ensureDockerConfig(false, sockPath, undefined)).rejects.toThrow('EISDIR');
      expect(consoleMock).not.toHaveBeenCalled();
    });

    it('should set credsStore to default when empty', async() => {
      await subj.ensureDockerConfig(true, 'notrelevant', undefined);
      const rawConfig = await fs.promises.readFile(configPath, 'utf-8');
      const newConfig = JSON.parse(rawConfig);

      expect(newConfig.credsStore).toEqual(subj.getDefaultDockerCredsStore());
    });

    it('should set credsStore to default when it is "desktop" and it does not work', async() => {
      const credHelperWorkingMock = jest.spyOn(subj, 'credHelperWorking')
        .mockResolvedValue(false);

      try {
        await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
        await fs.promises.writeFile(configPath, JSON.stringify({ credsStore: 'desktop' }));
        await subj.ensureDockerConfig(true, 'notrelevant', undefined);
        const rawConfig = await fs.promises.readFile(configPath, 'utf-8');
        const newConfig = JSON.parse(rawConfig);

        expect(newConfig.credsStore).toEqual(subj.getDefaultDockerCredsStore());

      } finally {
        credHelperWorkingMock.mockRestore();
      }
    });

    it('should not change credsStore when it is "desktop" and it works', async() => {
      const credHelperWorkingMock = jest.spyOn(subj, 'credHelperWorking')
        .mockResolvedValue(true);

      try {
        await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
        await fs.promises.writeFile(configPath, JSON.stringify({ credsStore: 'desktop' }));
        await subj.ensureDockerConfig(true, 'notrelevant', undefined);
        const rawConfig = await fs.promises.readFile(configPath, 'utf-8');
        const newConfig = JSON.parse(rawConfig);

        expect(newConfig.credsStore).toEqual('desktop');
      } finally {
        credHelperWorkingMock.mockRestore();
      }
    });

    it('should not change any irrelevant keys in config.json', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ otherKey: 'otherValue' }));
      await subj.ensureDockerConfig(true, 'notrelevant', undefined);
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
      await expect(fs.promises.lstat(path.dirname(metaPath))).rejects.toThrowError('ENOENT');
      expect(consoleMock).not.toHaveBeenCalled();
    });

    it('should unset docker context as needed', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'rancher-desktop' }));
      await expect(subj['clearDockerContext']()).resolves.toBeUndefined();

      const contents = JSON.parse(await fs.promises.readFile(configPath, 'utf-8')) ?? {};

      expect(contents).not.toHaveProperty('currentContext');
      expect(consoleMock).not.toHaveBeenCalled();
    });

    it('should not unset unrelated docker context', async() => {
      const context = 'unrelated-context';

      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: context }));
      await expect(subj['clearDockerContext']()).resolves.toBeUndefined();

      const contents = JSON.parse(await fs.promises.readFile(configPath, 'utf-8')) ?? {};

      expect(contents).toHaveProperty('currentContext', context);
      expect(consoleMock).not.toHaveBeenCalled();
    });

    it('should not fail if docker config is missing', async() => {
      await fs.promises.mkdir(path.dirname(metaPath), { recursive: true });
      await fs.promises.writeFile(metaPath, 'irrelevant');

      await expect(subj['clearDockerContext']()).resolves.toBeUndefined();
      expect(consoleMock).not.toHaveBeenCalled();
    });
  });

  describe('credHelperWorking', () => {
    let fakeProcess: childProcess.ChildProcess;
    let spawnMock: jest.SpiedFunction<typeof childProcess.spawn>;

    beforeAll(() => {
      spawnMock = jest.spyOn(childProcess, 'spawn')
        .mockImplementation(() => {
          fakeProcess = new childProcess.ChildProcess();

          return fakeProcess;
        });
    });

    afterAll(() => {
      spawnMock.mockRestore();
    });

    it('should return false when cred helper is not working', async() => {
      const testPromise = expect(subj.credHelperWorking('mockhelper')).resolves.toBeFalsy();

      fakeProcess.emit('exit', 1);
      await testPromise;
    });

    it('should return true when cred helper is working', async() => {
      const testPromise = expect(subj.credHelperWorking('mockhelper')).resolves.toBeTruthy();

      fakeProcess.emit('exit', 0);
      await testPromise;
    });
  });
});
