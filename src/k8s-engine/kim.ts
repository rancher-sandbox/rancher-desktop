import { Buffer } from 'buffer';
import { ChildProcess, spawn } from 'child_process';
import { Console } from 'console';
import { EventEmitter } from 'events';
import net from 'net';
import os from 'os';
import path from 'path';
import timers from 'timers';
import tls from 'tls';
import util from 'util';

import * as k8s from '@kubernetes/client-node';

import * as childProcess from '@/utils/childProcess';
import * as K8s from '@/k8s-engine/k8s';
import mainEvents from '@/main/mainEvents';
import Logging from '@/utils/logging';
import resources from '@/resources';
import LimaBackend from '@/k8s-engine/lima';

const REFRESH_INTERVAL = 5 * 1000;

const console = new Console(Logging.kim.stream);

function defined<T>(input: T | undefined | null): input is T {
  return typeof input !== 'undefined' && input !== null;
}

interface childResultType {
  stdout: string;
  stderr: string;
  code: number;
  signal?: string;
}

interface imageType {
  imageName: string,
  tag: string,
  imageID: string,
  size: string,
}

interface Kim extends EventEmitter {
  /**
   * Emitted when the images are different.  Note that we will only refresh the
   * image list when listeners are registered for this event.
   */
  on(event: 'images-changed', listener: (images: imageType[]) => void): this;

  /**
   * Emitted when command output is received.
   */
  on(event: 'kim-process-output', listener: (data: string, isStderr: boolean) => void): this;

  /**
   * Emitted when the Kim backend readiness has changed.
   */
  on(event: 'readiness-changed', listener: (isReady: boolean) => void): this;

  // Inherited, for internal handling.
  on(event: 'newListener', listener: (eventName: string | symbol, listener: (...args: any[]) => void) => void): this;
  on(event: 'removeListener', listener: (eventName: string | symbol, listener: (...args: any[]) => void) => void): this;
}

class Kim extends EventEmitter {
  private showedStderr = false;
  private refreshInterval: ReturnType<typeof timers.setInterval> | null = null;
  // During startup `kim images` repeatedly fires the same error message. Instead,
  // keep track of the current error and give a count instead.
  private lastErrorMessage = '';
  private sameErrorMessageCount = 0;
  private images: imageType[] = [];
  private _isReady = false;
  private isK8sReady = false;
  private hasImageListeners = false;
  private isWatching = false;
  private k8sManager: K8s.KubernetesBackend|null;

  constructor(k8sManager: K8s.KubernetesBackend) {
    super();
    this.k8sManager = k8sManager;
    this._refreshImages = this.refreshImages.bind(this);
    this.on('newListener', (event: string | symbol) => {
      if (event === 'images-changed' && !this.hasImageListeners) {
        this.hasImageListeners = true;
        this.updateWatchStatus();
      }
    });
    this.on('removeListener', (event: string | symbol) => {
      if (event === 'images-changed' && this.hasImageListeners) {
        this.hasImageListeners = this.listeners('images-changed').length > 0;
        this.updateWatchStatus();
      }
    });
    mainEvents.on('k8s-check-state', async(mgr: K8s.KubernetesBackend) => {
      this.isK8sReady = mgr.state === K8s.State.STARTED;
      this.updateWatchStatus();
      if (this.isK8sReady) {
        let endpoint: string | undefined;

        // XXX temporary hack: use a fixed address for kim endpoint
        if (mgr.backend === 'lima') {
          endpoint = '127.0.0.1';
        }

        const needsForce = !(await this.isInstallValid(mgr, endpoint));

        this.install(mgr, needsForce, endpoint);
      }
    });
  }

  protected updateWatchStatus() {
    const shouldWatch = this.isK8sReady && this.hasImageListeners;

    if (this.isWatching === shouldWatch) {
      return;
    }

    if (this.refreshInterval) {
      timers.clearInterval(this.refreshInterval);
    }
    if (shouldWatch) {
      this.refreshInterval = timers.setInterval(this._refreshImages, REFRESH_INTERVAL);
      timers.setImmediate(this._refreshImages);
    }
    this.isWatching = shouldWatch;
  }

  get isReady() {
    return this._isReady;
  }

  async runKimCommand(args: string[], sendNotifications = true): Promise<childResultType> {
    if (!args.includes('--context') && !args.includes('x')) {
      args.push('--context', 'rancher-desktop');
    }
    return await this.processChildOutput(spawn(resources.executable('kim'), args), args[0], sendNotifications);
  }

  async runTrivyCommand(args: string[], sendNotifications = true): Promise<childResultType> {
    let child: ChildProcess;
    const subcommandName = args[0];

    if (os.platform().startsWith('win')) {
      args = ['-d', 'rancher-desktop', 'trivy'].concat(args);
      child = spawn('wsl', args);
    } else if (os.platform().startsWith('darwin')) {
      const limaBackend = this.k8sManager as LimaBackend;

      args = ['trivy'].concat(args);
      child = limaBackend.limaSpawn(args);
    } else {
      throw new Error(`Don't know how to run trivy on platform ${ os.platform() }`);
    }

    return await this.processChildOutput(child, subcommandName, sendNotifications);
  }

  async processChildOutput(child: ChildProcess, subcommandName: string, sendNotifications: boolean): Promise<childResultType> {
    const result = { stdout: '', stderr: '' };

    return await new Promise((resolve, reject) => {
      child.stdout?.on('data', (data: Buffer) => {
        const dataString = data.toString();

        if (sendNotifications) {
          this.emit('kim-process-output', dataString, false);
        }
        result.stdout += dataString;
      });
      child.stderr?.on('data', (data: Buffer) => {
        const dataString = data.toString();

        result.stderr += dataString;
        if (sendNotifications) {
          this.emit('kim-process-output', dataString, true);
        }
      });
      child.on('exit', (code, signal) => {
        if (result.stderr) {
          const timeLessMessage = result.stderr.replace(/\btime=".*?"/g, '');

          if (this.lastErrorMessage !== timeLessMessage) {
            this.lastErrorMessage = timeLessMessage;
            this.sameErrorMessageCount = 1;
            console.log(result.stderr.replace(/(?!<\r)\n/g, '\r\n'));
          } else {
            const m = /(Error: .*)/.exec(this.lastErrorMessage);

            this.sameErrorMessageCount += 1;
            console.log(`kim ${ subcommandName }: ${ m ? m[1] : 'same error message' } #${ this.sameErrorMessageCount }\r`);
          }
        }
        if (code === 0) {
          resolve({ ...result, code });
        } else if (signal) {
          reject({
            ...result, code: -1, signal
          });
        } else {
          reject({ ...result, code });
        }
      });
    });
  }

  /**
   * Determine if the Kim service needs to be reinstalled.
   */
  protected async isInstallValid(mgr: K8s.KubernetesBackend, endpoint?: string): Promise<boolean> {
    const host = await mgr.ipAddress;

    if (!host) {
      return false;
    }

    const client = new k8s.KubeConfig();

    client.loadFromDefault();
    client.setCurrentContext('rancher-desktop');
    const api = client.makeApiClient(k8s.CoreV1Api);

    // Remove any stale pods; do this first, as we may end up having an invalid
    // configuration but with stale pods.  Note that `kim builder install --force`
    // will _not_ fix any stale pods.  We need to wait for the node IP to be
    // correct first, though, to ensure that we don't end up with a recreated
    // pod with the stale address.
    await this.waitForNodeIP(api, host);
    await this.removeStalePods(api);

    const wantedEndpoint = endpoint || host;

    // Check if the endpoint has the correct address
    try {
      const { body: endpointBody } = await api.readNamespacedEndpoints('builder', 'kube-image');
      const subset = endpointBody.subsets?.find(subset => subset.ports?.some(port => port.name === 'kim'));

      if (!(subset?.addresses || []).some(address => address.ip === wantedEndpoint)) {
        console.log('Existing kim install invalid: incorrect endpoint address.');

        return false;
      }
    } catch (ex) {
      if (ex.statusCode === 404) {
        console.log('Existing kim install invalid: missing endpoint');

        return false;
      }
      console.error('Error looking for endpoints:', ex);
      throw ex;
    }

    // Check if the certificate has the correct address
    const { body: secretBody } = await api.readNamespacedSecret('kim-tls-server', 'kube-image');
    const encodedCert = (secretBody.data || {})['tls.crt'];

    // If we don't have a cert, that's fine — kim will fix it.
    if (encodedCert) {
      const cert = Buffer.from(encodedCert, 'base64');
      const secureContext = tls.createSecureContext({ cert });
      const socket = new tls.TLSSocket(new net.Socket(), { secureContext });
      const parsedCert = socket.getCertificate();

      console.log(parsedCert);
      if (parsedCert && 'subjectaltname' in parsedCert) {
        const { subjectaltname } = parsedCert;
        const names = subjectaltname.split(',').map(s => s.trim());
        const acceptable = [`IP Address:${ wantedEndpoint }`, `DNS:${ wantedEndpoint }`];

        if (!names.some(name => acceptable.includes(name))) {
          console.log(`Existing kim install invalid: incorrect certificate (${ subjectaltname } does not contain ${ wantedEndpoint }).`);

          return false;
        }
      }
    }

    return true;
  }

  /**
   * Wait for the Kubernetes node to have the expected IP address.
   *
   * When the (single-node) cluster initially starts up, the node (internal)
   * address can take a while to be updated.
   * @param api API to communicate with Kubernetes.
   * @param hostAddr The expected node address.
   */
  protected async waitForNodeIP(api: k8s.CoreV1Api, hostAddr: string) {
    console.log(`Waiting for Kubernetes node IP to become ${ hostAddr }...`);
    while (true) {
      const { body: nodeList } = await api.listNode();
      const addresses = nodeList.items
        .flatMap(node => node.status?.addresses)
        .filter(defined)
        .filter(address => address.type === 'InternalIP')
        .flatMap(address => address.address);

      if (addresses.includes(hostAddr)) {
        break;
      }
      await util.promisify(setTimeout)(1_000);
    }
  }

  /**
   * When we start the cluster, we may have leftover pods from the builder
   * daemonset that have stale addresses.  They will not work correctly (not
   * listening on the new address), but their existence will prevent a new,
   * correct pod from being created.
   *
   * @param api API to communicate with Kubernetes.
   * @param hostAddr The expected node address.
   */
  protected async removeStalePods(api: k8s.CoreV1Api) {
    const { body: nodeList } = await api.listNode();
    const addresses = nodeList.items
      .flatMap(node => node.status?.addresses)
      .filter(defined)
      .filter(address => address.type === 'InternalIP')
      .flatMap(address => address.address);

    const { body: podList } = await api.listNamespacedPod(
      'kube-image', undefined, undefined, undefined, undefined,
      'app.kubernetes.io/name=kim,app.kubernetes.io/component=builder');

    for (const pod of podList.items) {
      const { namespace, name } = pod.metadata || {};

      if (!namespace || !name) {
        continue;
      }
      const currentAddress = pod.status?.podIP;

      if (currentAddress && !addresses.includes(currentAddress)) {
        console.log(`Deleting stale builder pod ${ namespace }:${ name } - pod IP ${ currentAddress } not in ${ addresses }`);
        api.deleteNamespacedPod(name, namespace);
      } else {
        console.log(`Keeping builder pod ${ namespace }:${ name } - pod IP ${ currentAddress } in ${ addresses }`);
      }
    }
  }

  /**
   * Install the kim backend if required; this returns when the backend is ready.
   * @param force If true, force a reinstall of the backend.
   */
  async install(backend: K8s.KubernetesBackend, force = false, address?: string) {
    if (!force && await backend.isServiceReady('kube-image', 'builder')) {
      console.log('Skipping kim reinstall: service is ready, and without --force');

      return;
    }

    const startTime = Date.now();
    const maxWaitTime = 120_000;
    const waitTime = 3_000;
    const args = ['builder', 'install'];

    if (force) {
      args.push('--force');
    }

    if (address) {
      args.push('--endpoint-addr', address);
    }

    console.log(`Installing kim: kim ${ args.join(' ') }`);

    try {
      await childProcess.spawnFile(
        resources.executable('kim'),
        args,
        {
          stdio:       ['ignore', await Logging.kim.fdStream, await Logging.kim.fdStream],
          windowsHide: true,
        });

      while (true) {
        const currentTime = Date.now();

        if ((currentTime - startTime) > maxWaitTime) {
          console.log(`Waited more than ${ maxWaitTime / 1000 } secs, it might start up later`);
          break;
        }
        if (await backend.isServiceReady('kube-image', 'builder')) {
          break;
        }
        await util.promisify(setTimeout)(waitTime);
      }
    } catch (e) {
      console.error(`Failed to restart the kim builder: ${ e.message }.`);
      console.error('The images page will probably be empty');
    }
  }

  async buildImage(dirPart: string, filePart: string, taggedImageName: string): Promise<childResultType> {
    const args = ['build'];

    args.push('--file');
    args.push(path.join(dirPart, filePart));
    args.push('--tag');
    args.push(taggedImageName);
    args.push(dirPart);

    return await this.runKimCommand(args);
  }

  async deleteImage(imageID: string): Promise<childResultType> {
    return await this.runKimCommand(['rmi', imageID]);
  }

  async pullImage(taggedImageName: string): Promise<childResultType> {
    return await this.runKimCommand(['pull', taggedImageName, '--debug']);
  }

  async pushImage(taggedImageName: string): Promise<childResultType> {
    return await this.runKimCommand(['push', taggedImageName, '--debug']);
  }

  async getImages(): Promise<childResultType> {
    return await this.runKimCommand(['images', '--all'], false);
  }

  async scanImage(taggedImageName: string): Promise<childResultType> {
    return await this.runTrivyCommand(['image', '--no-progress', '--format', 'template',
      '--template', '@/var/lib/trivy.tpl', taggedImageName]);
  }

  parse(data: string): imageType[] {
    const results = data.trimEnd().split(/\r?\n/).slice(1).map((line) => {
      const [imageName, tag, imageID, size] = line.split(/\s+/);

      return {
        imageName, tag, imageID, size
      };
    });

    return results;
  }

  listImages(): imageType[] {
    return this.images;
  }

  async refreshImages() {
    try {
      const result: childResultType = await this.getImages();

      if (result.stderr) {
        if (!this.showedStderr) {
          console.log(`kim images: ${ result.stderr } `);
          this.showedStderr = true;
        }
      } else {
        this.showedStderr = false;
      }
      this.images = this.parse(result.stdout);
      if (!this._isReady) {
        this._isReady = true;
        this.emit('readiness-changed', true);
      }
      this.emit('images-changed', this.images);
    } catch (err) {
      if (!this.showedStderr) {
        if (err.stderr && !err.stdout && !err.signal) {
          console.log(err.stderr);
        } else {
          console.log(err);
        }
      }
      this.showedStderr = true;
      if ('code' in err && this._isReady) {
        this._isReady = false;
        this.emit('readiness-changed', false);
      }
    }
  }

  _refreshImages: () => Promise<void>;
}

export default Kim;
