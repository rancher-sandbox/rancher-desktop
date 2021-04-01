// Kuberentes backend for Windows, based on WSL2 + k3s

import childProcess from 'child_process';
import events from 'events';
import fs from 'fs';
import path from 'path';
import util from 'util';

import fetch from 'node-fetch';
import XDGAppPaths from 'xdg-app-paths';

import { Settings } from '../config/settings';
import * as K8s from './k8s';

const paths = XDGAppPaths('rancher-desktop');

export default class WSLBackend extends events.EventEmitter implements K8s.KubernetesBackend {
  constructor(cfg: Settings['kubernetes']) {
    super();
    this.cfg = cfg;
  }

  /** Download URL for the distribution image */
  protected get distroURL() {
    return 'https://github.com/jandubois/tinyk3s/releases/download/v0.1/distro.tar';
  }

  protected get distroFile() {
    return path.join(paths.cache(), `distro-${ this.version }.tar`);
  }

  protected cfg: Settings['kubernetes'];

  protected process: childProcess.ChildProcess | null = null;

  /** The current user-visible state of the backend. */
  protected _state: K8s.State = K8s.State.STOPPED;
  get state() {
    return this._state;
  }

  get version(): string {
    // TODO: actually do something sensible with this.
    return 'v1.19.7+k3s1';
  }

  get cpus(): Promise<number> {
    // This doesn't make sense for WSL2, since that's a global configuration.
    return Promise.resolve(0);
  }

  get memory(): Promise<number> {
    // This doesn't make sense for WSL2, since that's a global configuration.
    return Promise.resolve(0);
  }

  /**
   * Ensure that the distribution file exists; download the file if it is
   * missing.  It is expected that half-downloaded files will not be mistakenly
   * placed where we expect the file to be.
   */
  protected async ensureDistroFile(): Promise<void> {
    try {
      await util.promisify(fs.stat)(this.distroFile);

      return;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }

    // If we reach here, then we need to download the tarball.
    // NodeJS doesn't have a way to create temporary files in the standard
    // library, and the popular libraries just use random names + O_EXCL
    await util.promisify(fs.mkdir)(paths.cache(), { recursive: true });
    const dir = await util.promisify(fs.mkdtemp)(path.join(paths.cache(), 'distro-'));
    const outPath = path.join(dir, path.basename(this.distroFile));

    try {
      const response = await fetch(this.distroURL);

      if (!response.ok) {
        throw new Error(`Failure downloading distribution: ${ response.statusText }`);
      }
      await new Promise((resolve) => {
        const stream = fs.createWriteStream(outPath);

        response.body.on('end', resolve);
        response.body.pipe(stream);
      });
      await util.promisify(fs.rename)(outPath, this.distroFile);
    } finally {
      try {
        await util.promisify(fs.unlink)(outPath);
      } catch (e) {
        if (e.code !== 'ENOENT') {
          // Re-throwing exceptions is no worse than not catching it at all.
          // eslint-disable-next-line no-unsafe-finally
          throw e;
        }
      }
      await util.promisify(fs.rmdir)(dir);
    }
  }

  protected async isDistroRegistered(): Promise<boolean> {
    const execFile = util.promisify(childProcess.execFile);
    const args = ['--list', '--quiet'];
    const options: childProcess.SpawnOptions = {
      stdio:       ['ignore', 'pipe', 'inherit'],
      windowsHide: true
    };
    const { stdout } = await execFile('wsl.exe', args, options);

    return stdout.split(/[\r\n]+/).includes('k3s');
  }

  /**
   * Ensure that the distribution has been installed into WSL2.
   */
  protected async ensureDistroRegistered(): Promise<void> {
    const execFile = util.promisify(childProcess.execFile);

    if (await this.isDistroRegistered()) {
      // k3s is already registered.
      return;
    }
    await this.ensureDistroFile();
    const distroPath = path.join(paths.state(), 'distro');
    const args = ['--import', 'k3s', distroPath, this.distroFile];
    const options: childProcess.SpawnOptions = { stdio: 'inherit', windowsHide: true };

    await execFile('wsl.exe', args, options);
    if (!await this.isDistroRegistered()) {
      throw new Error(`Error registration WSL2 distribution`);
    }
  }

  async start(): Promise<void> {
    if (this.process) {
      await this.stop();
    }

    const args = ['--distribution', 'k3s', 'run-k3s', this.version];
    const options: childProcess.SpawnOptions = {
      env:         { ...process.env },
      stdio:       'inherit',
      windowsHide: true,
    };

    this._state = K8s.State.STARTING;
    await this.ensureDistroRegistered();
    this.process = childProcess.spawn('wsl.exe', args, options);
    this._state = K8s.State.STARTED;
  }

  async stop(): Promise<number> {
    const execFile = util.promisify(childProcess.execFile);
    const options: childProcess.SpawnOptions = {
      stdio:       'inherit',
      windowsHide: true,
    };

    this._state = K8s.State.STOPPING;
    this.process?.kill('SIGTERM');
    await execFile('wsl.exe', ['--terminate', 'k3s'], options);
    this._state = K8s.State.STOPPED;

    return 0;
  }

  async del(): Promise<number> {
    const execFile = util.promisify(childProcess.execFile);
    const options: childProcess.SpawnOptions = {
      stdio:       'inherit',
      windowsHide: true,
    };

    await this.stop();
    await execFile('wsl.exe', ['--unregister', 'k3s'], options);

    return 0;
  }

  reset(): Promise<void> {
    return Promise.reject(new Error('Method not implemented.'));
  }

  factoryReset(): Promise<void> {
    return Promise.reject(new Error('Method not implemented.'));
  }

  listServices(namespace?: string): K8s.ServiceEntry[] {
    // TODO: implement me.
    return [];
  }

  requiresRestartReasons(): Promise<Record<string, [any, any] | []>> {
    return Promise.reject(new Error('Method not implemented.'));
  }

  forwardPort(namespace: string, service: string, port: number): Promise<number | null> {
    return Promise.reject(new Error('Method not implemented.'));
  }

  cancelForward(namespace: string, service: string, port: number): Promise<void> {
    return Promise.reject(new Error('Method not implemented.'));
  }
}
