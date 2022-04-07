import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import K3sHelper from '../k3sHelper';
import LimaBackend from '../lima';

jest.mock('../k3sHelper');
jest.mock('electron', () => ({}));

describe('LimaBackend', () => {
  describe('updateDockerContext', () => {
    /** The instance of LimaBackend under test. */
    let subj: LimaBackend;
    /** A directory we can use for scratch files during the test. */
    let workdir: string;
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

    beforeAll(() => {
      jest.spyOn(K3sHelper.prototype, 'initialize').mockResolvedValue();
      jest.spyOn(K3sHelper.prototype, 'on').mockImplementation();
      jest.spyOn(os, 'homedir').mockImplementation(() => workdir);
    });
    afterAll(() => {
      jest.clearAllMocks();
    });

    beforeEach(async() => {
      await expect((async() => {
        subj = new LimaBackend('x86_64');
        workdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rancher-desktop-lima-test-'));
        configPath = path.join(workdir, '.docker', 'config.json');
        metaPath = path.join(workdir, '.docker', 'contexts', 'meta',
          'b547d66a5de60e5f0843aba28283a8875c2ad72e99ba076060ef9ec7c09917c8',
          'meta.json');
        altMetaPath = path.join(workdir, '.docker', 'contexts', 'meta',
          '43999461d22f67840fcd9b8824293eaa4f18146e57b2c651bcd925e3b3e4e429',
          'meta.json');
        sockPath = path.join(workdir, 'docker.sock');
        altSockPath = path.join(workdir, 'pikachu.sock');
      })()).resolves.toBeUndefined();
    });
    afterEach(async() => {
      await fs.promises.rm(workdir, { recursive: true });
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
    });

    it('should clear context when default', async() => {
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
      await expect(subj['updateDockerContext'](sockPath, undefined, true)).resolves.toBeUndefined();
      expect(JSON.parse(await fs.promises.readFile(configPath, 'utf-8'))).toEqual({});

      const spy = jest.spyOn(fs.promises, 'writeFile');

      await subj['updateDockerContext'](sockPath, undefined, true);
      expect(spy).toHaveBeenCalledWith(metaPath, expect.anything());
      expect(spy).not.toHaveBeenCalledWith(configPath, expect.anything());
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
    });

    it('should update kubernetes endpoint', async() => {
      const kubeURL = 'http://kubernetes.test:2345';

      await expect(subj['updateDockerContext'](sockPath, kubeURL, false)).resolves.toBeUndefined();

      const result = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));

      expect(result).toHaveProperty('Name', 'rancher-desktop');
      expect(result).toHaveProperty('Endpoints.kubernetes.Host', kubeURL);
    });

    it('should allow for existing invalid configuration', async() => {
      const metaDir = path.join(workdir, '.docker', 'contexts', 'meta');

      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.writeFile(configPath, JSON.stringify({ currentContext: 'pikachu' }));
      await fs.promises.mkdir(path.join(metaDir, 'invalid-context', 'meta.json'), { recursive: true });
      await fs.promises.writeFile(path.join(metaDir, 'invalid-context-two'), '');
      await expect(subj['updateDockerContext'](sockPath, undefined, false)).resolves.toBeUndefined();
    });

    it('should throw errors reading config.json', async() => {
      await fs.promises.mkdir(configPath, { recursive: true });
      await expect(subj['updateDockerContext'](sockPath, undefined, false)).rejects.toThrow('EISDIR');
    });
  });
});
