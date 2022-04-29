import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import K3sHelper from '../k3sHelper';
import LimaBackend from '../lima';

jest.mock('../k3sHelper');
jest.mock('electron', () => ({}));

describe('LimaBackend', () => {
  /** The instance of LimaBackend under test. */
  let subj: LimaBackend;
  /** A directory we can use for scratch files during the test. */
  let workdir: string;
  /** Mocked console.log() to check messages. */
  let consoleMock: jest.SpyInstance<void, [message?: any, ...optionalArgs: any[]]>;

  beforeAll(() => {
    jest.spyOn(K3sHelper.prototype, 'initialize').mockResolvedValue();
    jest.spyOn(K3sHelper.prototype, 'on').mockImplementation();
    jest.spyOn(os, 'homedir').mockImplementation();
  });
  afterAll(() => {
    jest.clearAllMocks();
  });
  beforeEach(async() => {
    await expect((async() => {
      workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rancher-desktop-lima-test-'));
      jest.spyOn(os, 'homedir').mockReturnValue(workdir);
      consoleMock = jest.spyOn(console, 'log');
      subj = new LimaBackend('x86_64');
    })()).resolves.toBeUndefined();
  });
  afterEach(async() => {
    consoleMock.mockReset();
    await fs.promises.rm(workdir, { recursive: true });
  });

  describe('updateDockerContext', () => {
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

    it('should generate additional docker context', async() => {
      await expect(subj['updateDockerContext'](sockPath, undefined, true)).resolves.toBeUndefined();
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

    it('should clear context when default', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
      await expect(subj['updateDockerContext'](sockPath, undefined, true)).resolves.toBeUndefined();
      expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toEqual({});

      const spy = jest.spyOn(fs.promises, 'writeFile');

      await expect(subj['updateDockerContext'](sockPath, undefined, true)).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledWith(metaPath, expect.anything());
      expect(spy).not.toHaveBeenCalledWith(configPath, expect.anything());
      expect(consoleMock).not.toHaveBeenCalled();
    });

    it('should do nothing if context already set', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'rancher-desktop' }));
      const readdirSpy = jest.spyOn(fs.promises, 'readdir');
      const writeFileSpy = jest.spyOn(fs.promises, 'writeFile').mockClear();

      await expect(subj['updateDockerContext'](sockPath, undefined, false)).resolves.toBeUndefined();
      expect(readdirSpy).not.toHaveBeenCalled();
      expect(writeFileSpy).toHaveBeenCalledWith(metaPath, expect.anything());
      expect(writeFileSpy).not.toHaveBeenCalledWith(configPath, expect.anything());
      expect(consoleMock).not.toHaveBeenCalled();
    });

    it('should not touch working unix socket', async() => {
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
        await expect(subj['updateDockerContext'](sockPath, undefined, false)).resolves.toBeUndefined();

        expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toHaveProperty('currentContext', 'pikachu');
        expect(consoleMock).not.toHaveBeenCalled();
      } finally {
        server.close();
      }
    });

    it('should update missing socket', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
      await fs.promises.mkdir(path.dirname(altMetaPath), { recursive: true });
      await fs.promises.writeFile(altMetaPath, JSON.stringify({
        Name:      'pikachu',
        Endpoints: { docker: { Host: `unix://${ altSockPath }` } },
      }));

      await expect(subj['updateDockerContext'](sockPath, undefined, false)).resolves.toBeUndefined();

      expect(consoleMock).toHaveBeenCalledWith(
        expect.stringMatching(`Could not read existing docker socket.*${ workdir }.*pikachu.*ENOENT`),
        expect.anything());

      expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toHaveProperty('currentContext', 'rancher-desktop');
    });

    it('should update invalid socket', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
      await fs.promises.mkdir(path.dirname(altMetaPath), { recursive: true });
      await fs.promises.writeFile(altMetaPath, JSON.stringify({
        Name:      'pikachu',
        Endpoints: { docker: { Host: `unix://${ altSockPath }` } },
      }));
      await fs.promises.writeFile(altSockPath, '');

      await expect(subj['updateDockerContext'](sockPath, undefined, false)).resolves.toBeUndefined();

      expect(consoleMock).toHaveBeenCalledWith(
        expect.stringMatching(`Invalid existing context.*pikachu.*${ workdir }`),
        expect.anything());

      expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toHaveProperty('currentContext', 'rancher-desktop');
    });

    it('should not touch tcp socket', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
      await fs.promises.mkdir(path.dirname(altMetaPath), { recursive: true });
      await fs.promises.writeFile(altMetaPath, JSON.stringify({
        Name:      'pikachu',
        Endpoints: { docker: { Host: `tcp://server.test:1234` } },
      }));
      await expect(subj['updateDockerContext'](sockPath, undefined, false)).resolves.toBeUndefined();

      expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toHaveProperty('currentContext', 'pikachu');
      expect(consoleMock).not.toHaveBeenCalled();
    });

    it('should update kubernetes endpoint', async() => {
      const kubeURL = 'http://kubernetes.test:2345';

      await expect(subj['updateDockerContext'](sockPath, kubeURL, false)).resolves.toBeUndefined();

      const result = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));

      expect(result).toHaveProperty('Name', 'rancher-desktop');
      expect(result).toHaveProperty('Endpoints.kubernetes.Host', kubeURL);
      expect(consoleMock).not.toHaveBeenCalled();
    });

    it('should allow for existing invalid configuration', async() => {
      const metaDir = path.join(workdir, '.docker', 'contexts', 'meta');
      const statMock = jest.spyOn(fs.promises, 'stat')
        .mockImplementation((pathLike: fs.PathLike, opts?: fs.StatOptions | undefined) => {
          expect(pathLike).toEqual('/var/run/docker.sock');

          throw new Error(`ENOENT: no such file or directory, stat ${ pathLike }`);
        });

      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
      await fs.promises.mkdir(path.join(metaDir, 'invalid-context', 'meta.json'), { recursive: true });
      await fs.promises.writeFile(path.join(metaDir, 'invalid-context-two'), '');
      await expect(subj['updateDockerContext'](sockPath, undefined, false)).resolves.toBeUndefined();

      expect(consoleMock).toHaveBeenCalledWith(
        expect.stringMatching(`Failed to read context.*invalid-context.*EISDIR`),
        expect.anything());
      expect(consoleMock).toHaveBeenCalledWith(
        expect.stringMatching(`Failed to read context.*invalid-context-two.*ENOTDIR`),
        expect.anything());
      expect(consoleMock).toHaveBeenCalledWith(
        expect.stringMatching(`Could not read existing docker socket.*ENOENT`),
        expect.anything());
      statMock.mockRestore();
    });

    it('should throw errors reading config.json', async() => {
      await fs.promises.mkdir(configPath, { recursive: true });
      await expect(subj['updateDockerContext'](sockPath, undefined, false)).rejects.toThrow('EISDIR');
      expect(consoleMock).not.toHaveBeenCalled();
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
});
